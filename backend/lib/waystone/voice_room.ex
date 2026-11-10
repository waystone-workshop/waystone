defmodule Waystone.VoiceRoom do
  use Ecto.Schema
  import Ecto.Changeset

  schema "voice_rooms" do
    field :name, :string
    timestamps(type: :utc_datetime)
  end

  def changeset(room, attrs) do
    room
    |> cast(attrs, [:name])
    |> update_change(:name, &String.trim/1)
    |> validate_required([:name])
    |> validate_format(:name, ~r/\A[a-z0-9][a-z0-9-]{0,39}\z/)
    |> unique_constraint(:name)
  end
end
