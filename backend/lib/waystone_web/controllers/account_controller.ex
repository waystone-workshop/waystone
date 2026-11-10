defmodule WaystoneWeb.AccountController do
  use WaystoneWeb, :controller
  alias Waystone.Accounts
  plug :limit_auth when action in [:register, :login, :password]
  plug WaystoneWeb.Authenticate when action not in [:register, :login]

  def register(conn, params) do
    case Accounts.register(params) do
      {:ok, user} ->
        session_response(conn |> put_status(201), user)

      {:error, :invite} ->
        conn |> put_status(401) |> json(%{error: "Check your invitation code."})

      {:error, changeset} ->
        invalid(conn, changeset)
    end
  end

  def login(conn, params) do
    case Accounts.login(params["username"], params["password"]) do
      {:ok, user} -> session_response(conn, user)
      _ -> conn |> put_status(401) |> json(%{error: "Check your username and password."})
    end
  end

  defp session_response(conn, user),
    do:
      json(conn, %{
        token: Accounts.create_session(user),
        name: user.display_name,
        user: Accounts.profile(user)
      })

  def logout(conn, _) do
    Accounts.revoke_session(conn.assigns.session_token)
    json(conn, %{signed_out: true})
  end

  def me(conn, _), do: json(conn, Accounts.profile(conn.assigns.current_user))

  def users(conn, _),
    do: json(conn, %{users: Enum.map(Accounts.list_users(), &Accounts.profile/1)})

  def show(conn, %{"id" => id}) do
    case Accounts.get_user(id) do
      nil -> conn |> put_status(404) |> json(%{error: "Profile not found."})
      user -> json(conn, Accounts.profile(user))
    end
  end

  def update(conn, params) do
    case Accounts.update_profile(conn.assigns.current_user, params) do
      {:ok, user} -> json(conn, Accounts.profile(user))
      {:error, changeset} -> invalid(conn, changeset)
    end
  end

  def password(conn, params) do
    case Accounts.change_password(conn.assigns.current_user, params["current_password"], params) do
      {:ok, _} ->
        json(conn, %{signed_out: true})

      {:error, :credentials} ->
        conn |> put_status(401) |> json(%{error: "Current password is incorrect."})

      {:error, changeset} ->
        invalid(conn, changeset)
    end
  end

  def role(conn, %{"id" => id} = params) do
    case Accounts.change_role(conn.assigns.current_user, id, params["role"]) do
      {:ok, user} ->
        json(conn, Accounts.profile(user))

      {:error, :forbidden} ->
        conn |> put_status(403) |> json(%{error: "Only admins can change roles."})

      {:error, :not_found} ->
        conn |> put_status(404) |> json(%{error: "Profile not found."})

      {:error, :last_admin} ->
        conn |> put_status(422) |> json(%{error: "Keep at least one admin."})

      _ ->
        conn |> put_status(422) |> json(%{error: "Choose admin, moderator, or member."})
    end
  end

  defp invalid(conn, changeset) do
    errors =
      Ecto.Changeset.traverse_errors(changeset, fn {message, opts} ->
        Enum.reduce(opts, message, fn {key, value}, acc ->
          String.replace(acc, "%{#{key}}", to_string(value))
        end)
      end)

    conn |> put_status(422) |> json(%{error: "Check your profile details.", fields: errors})
  end

  defp limit_auth(conn, _) do
    if Waystone.Accounts.AuthLimiter.allow?(conn.remote_ip),
      do: conn,
      else:
        conn
        |> put_resp_header("retry-after", "60")
        |> put_status(429)
        |> json(%{error: "Too many attempts. Try again in a minute."})
        |> halt()
  end
end
