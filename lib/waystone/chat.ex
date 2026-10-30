defmodule Waystone.Chat do
  @moduledoc """
  The single lobby: display names and text messages.
  """

  import Ecto.Query

  alias Waystone.Chat.Message
  alias Waystone.Repo

  @topic "chat:lobby"
  @recent_limit 100

  def topic, do: @topic

  def list_messages do
    Message
    |> order_by(desc: :id)
    |> limit(^@recent_limit)
    |> Repo.all()
    |> Enum.reverse()
  end

  def create_message(author, attrs) when is_binary(author) and is_map(attrs) do
    %Message{}
    |> Message.changeset(%{author: author, body: attrs["body"] || attrs[:body]})
    |> Repo.insert()
    |> broadcast()
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

  defp broadcast({:ok, message} = result) do
    Phoenix.PubSub.broadcast(Waystone.PubSub, @topic, {:new_message, message})
    result
  end

  defp broadcast({:error, %Ecto.Changeset{}} = error), do: error

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
