defmodule Waystone.Chat.SharedFile do
  @moduledoc false

  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  schema "shared_files" do
    field :name, :string
    field :byte_size, :integer
    belongs_to :channel, Waystone.Chat.Channel
    belongs_to :user, Waystone.Accounts.User
    belongs_to :message, Waystone.Chat.Message

    timestamps(type: :utc_datetime)
  end
end
