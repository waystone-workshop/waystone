defmodule Waystone.Accounts.ProfileMedia do
  use Ecto.Schema

  schema "profile_media" do
    belongs_to :user, Waystone.Accounts.User
    field :kind, :string
    field :data, :binary, redact: true
    field :content_type, :string
  end
end
