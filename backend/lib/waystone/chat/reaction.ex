defmodule Waystone.Chat.Reaction do
  @moduledoc false

  use Ecto.Schema
  import Ecto.Changeset

  schema "message_reactions" do
    belongs_to :message, Waystone.Chat.Message
    belongs_to :user, Waystone.Accounts.User
    field :name, :string

    timestamps(type: :utc_datetime)
  end

  def changeset(reaction, attrs) do
    reaction
    |> cast(attrs, [:message_id, :user_id, :name])
    |> validate_required([:message_id, :user_id, :name])
    |> unique_constraint([:message_id, :user_id, :name])
  end
end
