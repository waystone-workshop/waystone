defmodule Waystone.Chat.Expression do
  @moduledoc false

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "expressions" do
    field :kind, :string
    field :name, :string
    field :content_type, :string
    field :byte_size, :integer
    belongs_to :user, Waystone.Accounts.User

    timestamps(type: :utc_datetime)
  end

  def changeset(expression, attrs) do
    expression
    |> cast(attrs, [:id, :kind, :name, :content_type, :byte_size, :user_id])
    |> validate_required([:id, :kind, :name, :content_type, :byte_size])
    |> validate_inclusion(:kind, ["emoji", "sticker"])
    |> unique_constraint([:kind, :name])
  end
end
