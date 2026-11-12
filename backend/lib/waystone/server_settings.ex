defmodule Waystone.ServerSettings do
  @moduledoc """
  One row of policy for the whole room. It is not a person's device preferences.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias Waystone.Repo

  schema "server_settings" do
    field :expression_uploads, :string, default: "member"
    field :emoji_max_bytes, :integer, default: 262_144
    field :sticker_max_bytes, :integer, default: 524_288
    field :expression_limit, :integer, default: 200

    timestamps(type: :utc_datetime)
  end

  def get! do
    case Repo.one(from(s in __MODULE__, limit: 1)) do
      nil -> Repo.insert!(%__MODULE__{})
      settings -> settings
    end
  end

  def update(attrs) do
    case get!() |> changeset(attrs) |> Repo.update() do
      {:ok, settings} = ok ->
        WaystoneWeb.Endpoint.broadcast("directory", "server_updated", public(settings))
        ok

      error ->
        error
    end
  end

  def public(%__MODULE__{} = settings) do
    %{
      expression_uploads: settings.expression_uploads,
      emoji_max_bytes: settings.emoji_max_bytes,
      sticker_max_bytes: settings.sticker_max_bytes,
      expression_limit: settings.expression_limit
    }
  end

  def error_message(changeset) do
    case changeset.errors do
      [{:expression_uploads, _} | _] -> "Choose who can add emoji and stickers."
      [{:emoji_max_bytes, _} | _] -> "Emoji pictures can be from 16 KB to 512 KB."
      [{:sticker_max_bytes, _} | _] -> "Stickers can be from 32 KB to 2 MB."
      [{:expression_limit, _} | _] -> "The shelf can hold from 1 to 500 of each."
      _ -> "Those server settings are not valid."
    end
  end

  def changeset(settings, attrs) do
    settings
    |> cast(attrs, [
      :expression_uploads,
      :emoji_max_bytes,
      :sticker_max_bytes,
      :expression_limit
    ])
    |> validate_required([
      :expression_uploads,
      :emoji_max_bytes,
      :sticker_max_bytes,
      :expression_limit
    ])
    |> validate_inclusion(:expression_uploads, ~w(off member moderator admin))
    |> validate_number(:emoji_max_bytes,
      greater_than_or_equal_to: 16 * 1024,
      less_than_or_equal_to: 512 * 1024
    )
    |> validate_number(:sticker_max_bytes,
      greater_than_or_equal_to: 32 * 1024,
      less_than_or_equal_to: 2 * 1024 * 1024
    )
    |> validate_number(:expression_limit, greater_than_or_equal_to: 1, less_than_or_equal_to: 500)
  end
end
