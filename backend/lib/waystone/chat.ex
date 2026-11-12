defmodule Waystone.Chat do
  @moduledoc """
  Channels, persisted messages and real-time delivery for one friend group.
  """

  import Ecto.Query

  alias Waystone.Chat.Message
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

    with {:ok, attachments} <-
           Waystone.Chat.Attachments.validate(attrs["attachments"] || [], author, channel_id) do
      changeset =
        %Message{channel_id: channel_id, attachments: attachments, user_id: user_id}
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
          WaystoneWeb.Endpoint.broadcast(topic(channel_id), "message", message_json(message))
          {:ok, message}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  def message_json(message) do
    %{
      id: message.id,
      channel_id: message.channel_id,
      author: message.author,
      user_id: message.user_id,
      body: message.body || "",
      attachments: Enum.map(message.attachments, &Map.drop(&1, ["data"])),
      inserted_at: message.inserted_at
    }
  end

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
