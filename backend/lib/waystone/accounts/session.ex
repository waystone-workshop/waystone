defmodule Waystone.Accounts.Session do
  use Ecto.Schema
  @primary_key {:token_hash, :binary, autogenerate: false}
  schema "user_sessions" do
    belongs_to :user, Waystone.Accounts.User
    field :expires_at, :utc_datetime
  end
end
