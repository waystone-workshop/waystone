defmodule Waystone.Chat.Message do
  @moduledoc false

  use Ecto.Schema
  import Ecto.Changeset

  @name_max 24
  @body_max 2_000

  schema "messages" do
    field :author, :string
    field :body, :string
    belongs_to :channel, Waystone.Chat.Channel
    field :attachments, {:array, :map}, default: []

    timestamps(type: :utc_datetime)
  end

  def name_max, do: @name_max
  def body_max, do: @body_max

  defp validate_content(changeset) do
    if get_field(changeset, :body) in [nil, ""] and get_field(changeset, :attachments) == [] do
      add_error(changeset, :body, "can't be blank")
    else
      put_change(changeset, :body, get_field(changeset, :body) || "")
    end
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:author, :body])
    |> update_change(:author, &String.trim/1)
    |> update_change(:body, &String.trim/1)
    |> validate_required([:author])
    |> validate_content()
    |> validate_length(:author, min: 1, max: @name_max)
    |> validate_length(:body, max: @body_max)
  end
end
