defmodule Waystone.Chat.Message do
  @moduledoc false

  use Ecto.Schema
  import Ecto.Changeset

  @name_max 24
  @body_max 2_000

  schema "messages" do
    field :author, :string
    field :body, :string

    timestamps(type: :utc_datetime)
  end

  def name_max, do: @name_max
  def body_max, do: @body_max

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:author, :body])
    |> update_change(:author, &String.trim/1)
    |> update_change(:body, &String.trim/1)
    |> validate_required([:author, :body])
    |> validate_length(:author, min: 1, max: @name_max)
    |> validate_length(:body, min: 1, max: @body_max)
  end
end
