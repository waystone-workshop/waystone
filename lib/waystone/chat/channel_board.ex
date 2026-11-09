defmodule Waystone.Chat.ChannelBoard do
  use Ecto.Schema
  @primary_key {:id, :string, autogenerate: false}
  schema "channel_boards" do
    belongs_to :channel, Waystone.Chat.Channel
    field :title, :string
    field :content, :map
    field :resources, {:array, :map}, default: []
    field :revision, :integer, default: 1
    timestamps(type: :utc_datetime)
  end
end
