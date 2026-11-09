defmodule Waystone.Chat.Channel do
  use Ecto.Schema
  import Ecto.Changeset

  schema "channels" do
    field :name, :string
    timestamps(type: :utc_datetime)
  end

  def changeset(channel, attrs) do
    channel
    |> cast(attrs, [:name])
    |> update_change(:name, &String.trim/1)
    |> validate_required([:name])
    |> validate_format(:name, ~r/^[a-z0-9][a-z0-9-]{0,39}$/)
    |> unique_constraint(:name)
  end
end
