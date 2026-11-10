defmodule Waystone.Accounts do
  import Ecto.Query
  alias Waystone.Repo
  alias Waystone.Accounts.{Password, Session, User}

  def register(attrs) do
    if invite_valid?(attrs["invite_code"]) do
      attrs = Map.put_new(attrs, "display_name", attrs["username"])
      %User{} |> User.registration_changeset(attrs) |> hash_password() |> Repo.insert()
    else
      {:error, :invite}
    end
  end

  defp hash_password(changeset) do
    if changeset.valid?,
      do:
        Ecto.Changeset.put_change(
          changeset,
          :password_hash,
          Password.hash(Ecto.Changeset.get_field(changeset, :password))
        ),
      else: changeset
  end

  defp invite_valid?(supplied) do
    expected = Application.get_env(:waystone, :invite_code)
    is_nil(expected) or (is_binary(supplied) and Plug.Crypto.secure_compare(expected, supplied))
  end

  def login(username, password) when is_binary(username) and byte_size(username) <= 128 do
    user = Repo.get_by(User, username: username |> String.trim() |> String.downcase())

    if Password.valid?(password, user && user.password_hash),
      do: {:ok, user},
      else: {:error, :credentials}
  end

  def login(_, _), do: {:error, :credentials}

  def create_session(user) do
    token = :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    Repo.delete_all(from s in Session, where: s.expires_at <= ^now)

    Repo.insert!(%Session{
      token_hash: token_hash(token),
      user_id: user.id,
      expires_at: DateTime.add(now, 604_800)
    })

    token
  end

  def authenticate(token) when is_binary(token) and byte_size(token) <= 128 do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    user =
      Repo.one(
        from s in Session,
          join: u in User,
          on: u.id == s.user_id,
          where: s.token_hash == ^token_hash(token) and s.expires_at > ^now,
          select: u
      )

    if user, do: {:ok, user}, else: :error
  end

  def authenticate(_), do: :error

  def revoke_session(token) do
    Repo.delete_all(from s in Session, where: s.token_hash == ^token_hash(token))
    WaystoneWeb.Endpoint.broadcast(socket_id(token), "disconnect", %{})
    :ok
  end

  def change_password(user, current_password, attrs) do
    if Password.valid?(current_password, user.password_hash) do
      result =
        Repo.transaction(fn ->
          changeset = user |> User.password_changeset(attrs) |> hash_password()

          case Repo.update(changeset) do
            {:ok, saved} ->
              sessions = Repo.all(from s in Session, where: s.user_id == ^saved.id)
              Repo.delete_all(from s in Session, where: s.user_id == ^saved.id)
              {saved, sessions}

            {:error, changeset} ->
              Repo.rollback(changeset)
          end
        end)

      case result do
        {:ok, {saved, sessions}} ->
          Enum.each(
            sessions,
            &WaystoneWeb.Endpoint.broadcast(socket_hash_id(&1.token_hash), "disconnect", %{})
          )

          {:ok, saved}

        error ->
          error
      end
    else
      {:error, :credentials}
    end
  end

  def socket_id(token), do: socket_hash_id(token_hash(token))
  defp socket_hash_id(hash), do: "session:" <> Base.url_encode64(hash, padding: false)
  defp token_hash(token), do: :crypto.hash(:sha256, token)
  def get_user(id) when is_integer(id), do: Repo.get(User, id)

  def get_user(id) when is_binary(id) do
    case Integer.parse(id) do
      {value, ""} when value > 0 -> Repo.get(User, value)
      _ -> nil
    end
  end

  def get_user(_), do: nil
  def list_users, do: Repo.all(from u in User, order_by: u.username)
  def update_profile(user, attrs), do: user |> User.profile_changeset(attrs) |> Repo.update()
  def manage_channels?(user), do: user.role in ["admin", "moderator"]

  def change_role(actor, id, role) when role in ["admin", "moderator", "member"] do
    Repo.transaction(
      fn ->
        current_actor = Repo.get!(User, actor.id)
        if current_actor.role != "admin", do: Repo.rollback(:forbidden)
        target = get_user(id) || Repo.rollback(:not_found)

        if target.role == "admin" and role != "admin" and
             Repo.aggregate(from(u in User, where: u.role == "admin"), :count) == 1,
           do: Repo.rollback(:last_admin)

        target |> Ecto.Changeset.change(role: role) |> Repo.update!()
      end,
      mode: :immediate
    )
  end

  def change_role(_, _, _), do: {:error, :invalid_role}

  # Deliberate server-console operation; registration can never choose a role.
  def promote_admin(username) do
    case Repo.get_by(User, username: String.downcase(username)) do
      nil -> {:error, :not_found}
      user -> user |> Ecto.Changeset.change(role: "admin") |> Repo.update()
    end
  end

  def profile(user),
    do: Map.take(user, [:id, :username, :display_name, :bio, :avatar_color, :role, :inserted_at])
end
