defmodule Waystone.Chat do
  @moduledoc """
  Channels, persisted messages and real-time delivery for one friend group.
  """

  import Ecto.Query

  alias Waystone.Chat.{Message, Reaction}
  alias Waystone.Repo

  def topic(channel_id), do: "chat:#{channel_id}"

  def list_channels, do: Repo.all(from c in Waystone.Chat.Channel, order_by: c.id)
  def get_channel!(id), do: Repo.get!(Waystone.Chat.Channel, id)

  def create_channel(attrs) do
    %Waystone.Chat.Channel{}
    |> Waystone.Chat.Channel.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, channel} ->
        WaystoneWeb.Endpoint.broadcast("directory", "channel_created", channel_json(channel))

        {:ok, channel}

      error ->
        error
    end
  end

  def get_board!(channel_id),
    do: Repo.get_by!(Waystone.Chat.ChannelBoard, channel_id: get_channel!(channel_id).id)

  def channel_json(channel) do
    board = get_board!(channel.id)
    %{id: channel.id, name: channel.name, board_id: board.id}
  end

  def board_json(board) do
    %{
      format: "waystone-board",
      version: 1,
      board: %{
        version: 1,
        id: board.id,
        type: "board",
        title: board.title,
        revision: board.revision,
        content: board.content,
        createdAt: DateTime.to_iso8601(board.inserted_at),
        updatedAt: DateTime.to_iso8601(board.updated_at)
      },
      canvases: board.resources
    }
  end

  def save_board(channel_id, params) do
    board = get_board!(channel_id)

    with true <- params["base_revision"] == board.revision,
         {:ok, attrs} <- Waystone.Chat.BoardDocument.validate(params, board.id) do
      result =
        board
        |> Ecto.Changeset.change(attrs)
        |> Ecto.Changeset.optimistic_lock(:revision)
        |> Repo.update()

      case result do
        {:ok, saved} ->
          WaystoneWeb.Endpoint.broadcast("directory", "board_updated", %{
            channel_id: saved.channel_id,
            board_id: saved.id,
            revision: saved.revision
          })

          {:ok, saved}

        error ->
          error
      end
    else
      false -> {:error, :conflict}
      error -> error
    end
  rescue
    Ecto.StaleEntryError -> {:error, :conflict}
  end

  def delete_channel(channel_id) do
    channel = get_channel!(channel_id)
    board = get_board!(channel.id)
    files = Waystone.Chat.Files.paths(channel.id)

    result =
      Repo.transaction(fn ->
        # SQLite cannot delete a message while another message in the same
        # statement still points at it.
        Repo.update_all(from(m in Message, where: m.channel_id == ^channel.id),
          set: [reply_to_id: nil]
        )

        Repo.delete_all(from m in Message, where: m.channel_id == ^channel.id)
        Repo.delete!(channel)
      end)

    case result do
      {:ok, _} ->
        Waystone.Chat.Files.remove(files)
        payload = %{id: channel.id, board_id: board.id}
        WaystoneWeb.Endpoint.broadcast("directory", "channel_deleted", payload)
        WaystoneWeb.Endpoint.broadcast(topic(channel.id), "channel_deleted", payload)
        {:ok, channel}

      error ->
        error
    end
  end

  def messages(channel_id, opts \\ []) do
    query = from m in Message, where: m.channel_id == ^channel_id, order_by: [asc: m.id]
    query = if opts[:from], do: from(m in query, where: m.id >= ^opts[:from]), else: query
    query = if opts[:to], do: from(m in query, where: m.id <= ^opts[:to]), else: query
    query = if opts[:metadata_only], do: metadata_only(query), else: query
    Repo.all(query)
  end

  def recent_messages(channel_id, before_id \\ nil) do
    query =
      from m in Message, where: m.channel_id == ^channel_id, order_by: [desc: m.id], limit: 100

    query = if before_id, do: from(m in query, where: m.id < ^before_id), else: query
    query |> metadata_only() |> Repo.all() |> Enum.reverse()
  end

  # History and Markdown previews must not load megabytes of image data per
  # message. SQLite strips the payloads before returning attachment metadata.
  defp metadata_only(query) do
    from m in query,
      select: %{
        id: m.id,
        channel_id: m.channel_id,
        author: m.author,
        user_id: m.user_id,
        body: m.body,
        reply_to_id: m.reply_to_id,
        edited_at: m.edited_at,
        inserted_at: m.inserted_at,
        attachments:
          type(
            fragment(
              "(SELECT json_group_array(json_remove(value, '$.data')) FROM json_each(?))",
              m.attachments
            ),
            {:array, :map}
          )
      }
  end

  def send_message(channel_id, author, attrs) do
    get_channel!(channel_id)

    {name, user_id} =
      case author do
        %Waystone.Accounts.User{} = user -> {user.display_name, user.id}
        name when is_binary(name) -> {name, nil}
      end

    with {:ok, reply_id} <- reply_target(channel_id, attrs["reply_to"]),
         {:ok, attachments} <-
           Waystone.Chat.Attachments.validate(attrs["attachments"] || [], author, channel_id) do
      changeset =
        %Message{
          channel_id: channel_id,
          attachments: attachments,
          user_id: user_id,
          reply_to_id: reply_id
        }
        |> Message.changeset(%{author: name, body: attrs["body"] || ""})

      result =
        Repo.transaction(fn ->
          case Repo.insert(changeset) do
            {:ok, message} ->
              Waystone.Chat.Files.bind(message, attachments, author)
              message

            {:error, changeset} ->
              Repo.rollback(changeset)
          end
        end)

      case result do
        {:ok, message} ->
          WaystoneWeb.Endpoint.broadcast(topic(channel_id), "message", present_message(message))
          {:ok, message}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  def edit_message(%Waystone.Accounts.User{} = user, id, attrs) do
    case Repo.get(Message, id) do
      nil ->
        {:error, :not_found}

      %Message{user_id: owner_id} = message when owner_id == user.id ->
        changeset =
          message
          |> Message.changeset(%{author: message.author, body: attrs["body"] || ""})
          |> Ecto.Changeset.put_change(
            :edited_at,
            DateTime.utc_now() |> DateTime.truncate(:second)
          )

        case Repo.update(changeset) do
          {:ok, saved} ->
            json = present_message(saved)
            WaystoneWeb.Endpoint.broadcast(topic(saved.channel_id), "message_updated", json)
            {:ok, saved}

          error ->
            error
        end

      _ ->
        {:error, :forbidden}
    end
  end

  def delete_message(%Waystone.Accounts.User{} = user, id) do
    case Repo.get(Message, id) do
      nil ->
        {:error, :not_found}

      %Message{} = message ->
        if message.user_id == user.id or Waystone.Accounts.manage_channels?(user) do
          Repo.delete!(message)

          WaystoneWeb.Endpoint.broadcast(topic(message.channel_id), "message_deleted", %{
            id: message.id,
            channel_id: message.channel_id
          })

          :ok
        else
          {:error, :forbidden}
        end
    end
  end

  def toggle_reaction(%Waystone.Accounts.User{} = user, message_id, name) do
    with {:ok, id} <- parse_id(message_id),
         %Message{} = message <- Repo.get(Message, id) do
      case Repo.get_by(Reaction, message_id: id, user_id: user.id, name: normalize_reaction(name)) do
        %Reaction{} = reaction ->
          Repo.delete!(reaction)
          {:ok, broadcast_reactions(message)}

        nil ->
          case Waystone.Chat.Expressions.known_emoji(name) do
            {:ok, emoji} ->
              %Reaction{}
              |> Reaction.changeset(%{message_id: id, user_id: user.id, name: emoji})
              |> Repo.insert!()

              {:ok, broadcast_reactions(message)}

            {:error, reason} ->
              {:error, reason}
          end
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def present_message(message), do: hd(present([message]))

  def present(messages) do
    replies = reply_lookup(messages)
    reactions = reaction_lookup(messages)

    Enum.map(messages, fn message ->
      message
      |> message_json()
      |> Map.put(:reply, reply_snapshot(Map.get(replies, Map.get(message, :reply_to_id))))
      |> Map.put(:reactions, Map.get(reactions, Map.get(message, :id), []))
    end)
  end

  def message_json(message) do
    %{
      id: message.id,
      channel_id: message.channel_id,
      author: message.author,
      user_id: message.user_id,
      body: message.body || "",
      attachments: Enum.map(message.attachments || [], &Map.drop(&1, ["data"])),
      inserted_at: message.inserted_at,
      edited_at: Map.get(message, :edited_at)
    }
  end

  defp broadcast_reactions(message) do
    payload = %{
      id: message.id,
      channel_id: message.channel_id,
      reactions: Map.get(reaction_lookup([message]), message.id, [])
    }

    WaystoneWeb.Endpoint.broadcast(topic(message.channel_id), "reaction", payload)
    payload
  end

  defp reaction_lookup(messages) do
    ids = Enum.map(messages, &Map.get(&1, :id))

    if ids == [] do
      %{}
    else
      Repo.all(
        from r in Reaction,
          where: r.message_id in ^ids,
          order_by: [asc: r.name, asc: r.user_id],
          select: %{message_id: r.message_id, name: r.name, user_id: r.user_id}
      )
      |> Enum.group_by(& &1.message_id)
      |> Map.new(fn {id, rows} ->
        grouped =
          rows
          |> Enum.group_by(& &1.name)
          |> Enum.map(fn {name, people} ->
            %{name: name, user_ids: Enum.map(people, & &1.user_id)}
          end)
          |> Enum.sort_by(& &1.name)

        {id, grouped}
      end)
    end
  end

  defp normalize_reaction(name) when is_binary(name) do
    name |> String.trim() |> String.downcase()
  end

  defp normalize_reaction(_), do: ""

  defp reply_target(_channel_id, nil), do: {:ok, nil}
  defp reply_target(_channel_id, ""), do: {:ok, nil}

  defp reply_target(channel_id, id) do
    with {:ok, id} <- parse_id(id),
         %Message{channel_id: ^channel_id} <- Repo.get(Message, id) do
      {:ok, id}
    else
      _ -> {:error, "Reply to a message in this channel."}
    end
  end

  defp parse_id(id) when is_integer(id) and id > 0, do: {:ok, id}

  defp parse_id(id) when is_binary(id) do
    case Integer.parse(id) do
      {n, ""} when n > 0 -> {:ok, n}
      _ -> :error
    end
  end

  defp parse_id(_), do: :error

  defp reply_lookup(messages) do
    ids =
      messages
      |> Enum.map(&Map.get(&1, :reply_to_id))
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    if ids == [] do
      %{}
    else
      Repo.all(
        from m in Message,
          where: m.id in ^ids,
          select: %{
            id: m.id,
            author: m.author,
            user_id: m.user_id,
            body: fragment("substr(?, 1, 140)", m.body),
            kind:
              fragment(
                "(SELECT json_extract(value, '$.kind') FROM json_each(?) LIMIT 1)",
                m.attachments
              ),
            name:
              fragment(
                "(SELECT json_extract(value, '$.name') FROM json_each(?) LIMIT 1)",
                m.attachments
              )
          }
      )
      |> Map.new(&{&1.id, &1})
    end
  end

  defp reply_snapshot(nil), do: nil

  defp reply_snapshot(target) do
    %{
      id: target.id,
      author: target.author,
      user_id: target.user_id,
      body: String.slice(target.body || "", 0, 140),
      attachment: preview_attachment(target)
    }
  end

  defp preview_attachment(%{kind: kind, name: name}) when is_binary(kind),
    do: %{kind: kind, name: name}

  defp preview_attachment(%{attachments: [first | _]}) when is_map(first) do
    kind = first["kind"] || first[:kind]
    name = first["name"] || first[:name]
    if is_binary(kind), do: %{kind: kind, name: name}
  end

  defp preview_attachment(_), do: nil

  def name_changeset(attrs) do
    {%{}, %{display_name: :string}}
    |> Ecto.Changeset.cast(attrs, [:display_name])
    |> Ecto.Changeset.update_change(:display_name, &String.trim/1)
    |> Ecto.Changeset.validate_required([:display_name])
    |> Ecto.Changeset.validate_length(:display_name, max: Message.name_max())
    |> validate_single_line(:display_name)
  end

  def apply_name(attrs) when is_map(attrs) do
    changeset = name_changeset(attrs)

    if changeset.valid? do
      {:ok, Ecto.Changeset.get_field(changeset, :display_name)}
    else
      {:error, %{changeset | action: :insert}}
    end
  end

  defp validate_single_line(changeset, field) do
    Ecto.Changeset.validate_change(changeset, field, fn ^field, value ->
      if String.match?(value, ~r/[\r\n\t]/u) do
        [{field, "must be a single line"}]
      else
        []
      end
    end)
  end
end
