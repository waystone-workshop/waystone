defmodule Waystone.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  @derive {Inspect, except: [:password, :password_hash]}
  schema "users" do
    field :username, :string
    field :display_name, :string
    field :bio, :string, default: ""
    field :avatar_color, :string, default: "pine"
    field :avatar_version, :string
    field :avatar_content_type, :string
    field :banner_version, :string
    field :banner_content_type, :string
    field :password_hash, :string, redact: true
    field :password, :string, virtual: true, redact: true
    field :role, :string, default: "member"
    timestamps(type: :utc_datetime)
  end

  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:username, :password, :display_name])
    |> update_change(:username, &(&1 |> String.trim() |> String.downcase()))
    |> validate_required([:username, :password, :display_name])
    |> validate_length(:username, min: 3, max: 24)
    |> validate_format(:username, ~r/\A[a-z0-9_]+\z/)
    |> validate_length(:password, min: 12, max: 128)
    |> validate_password_bytes()
    |> validate_profile()
    |> unique_constraint(:username)
  end

  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:display_name, :bio, :avatar_color], empty_values: [])
    |> validate_required([:display_name, :avatar_color])
    |> validate_profile()
    |> validate_length(:bio, max: 280)
    |> validate_inclusion(:avatar_color, ~w(pine amber slate berry))
    |> validate_bio()
  end

  def password_changeset(user, attrs) do
    user
    |> cast(attrs, [:password])
    |> validate_required([:password])
    |> validate_length(:password, min: 12, max: 128)
    |> validate_password_bytes()
  end

  defp validate_profile(changeset) do
    changeset
    |> update_change(:display_name, &String.trim/1)
    |> validate_length(:display_name, min: 1, max: 24)
    |> validate_format(:display_name, ~r/\A[^\r\n\t]+\z/u)
  end

  defp validate_password_bytes(changeset) do
    validate_change(changeset, :password, fn :password, value ->
      if byte_size(value) <= 512, do: [], else: [password: "is too long"]
    end)
  end

  defp validate_bio(changeset) do
    if is_nil(get_field(changeset, :bio)),
      do: add_error(changeset, :bio, "must be text"),
      else: changeset
  end
end
