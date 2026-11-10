defmodule WaystoneWeb.AccountsTest do
  use WaystoneWeb.ConnCase, async: false
  import Ecto.Query
  alias Waystone.{Accounts, Repo}
  alias Waystone.Accounts.{Session, User}

  setup %{conn: conn} do
    n = System.unique_integer([:positive])
    {:ok, conn: %{conn | remote_ip: {10, 22, div(n, 250) |> rem(250), rem(n, 250)}}}
  end

  defp auth(conn, user),
    do: put_req_header(conn, "authorization", "Bearer " <> Accounts.create_session(user))

  defp registration(overrides \\ %{}) do
    Map.merge(
      %{
        username: "new_user",
        display_name: "New Friend",
        password: "a-long-passphrase",
        invite_code: Application.get_env(:waystone, :invite_code)
      },
      overrides
    )
  end

  test "registration persists a member, ignores privilege injection, and returns safe fields", %{
    conn: conn
  } do
    result =
      conn
      |> post("/api/register", registration(%{role: "admin", password_hash: "injected"}))
      |> json_response(201)

    assert result["user"]["role"] == "member"
    refute Map.has_key?(result["user"], "password_hash")
    refute Map.has_key?(result["user"], "password")
    stored = Repo.get!(User, result["user"]["id"])
    refute stored.password_hash == "a-long-passphrase"
    assert Accounts.Password.valid?("a-long-passphrase", stored.password_hash)
    assert {:ok, authenticated} = Accounts.authenticate(result["token"])
    assert authenticated.id == stored.id
    refute Repo.exists?(from s in Session, where: s.token_hash == ^result["token"])
  end

  test "usernames are case-insensitive and unique; invalid credentials do not authenticate", %{
    conn: conn
  } do
    conn |> post("/api/register", registration(%{username: "New_User"})) |> json_response(201)
    conn |> post("/api/register", registration()) |> json_response(422)

    conn
    |> post("/api/session", %{username: "NEW_USER", password: "wrong-password"})
    |> json_response(401)

    result =
      conn
      |> post("/api/session", %{username: "NEW_USER", password: "a-long-passphrase"})
      |> json_response(200)

    assert result["user"]["username"] == "new_user"

    conn
    |> post("/api/session", %{name: "New Friend", invite_code: "anything"})
    |> json_response(401)

    conn
    |> post("/api/register", registration(%{username: "bad name", password: "short"}))
    |> json_response(422)
  end

  test "registration needs only username, password and invitation code", %{conn: conn} do
    params = registration() |> Map.delete(:display_name)
    result = conn |> post("/api/register", params) |> json_response(201)
    assert result["user"]["display_name"] == "new_user"
  end

  test "legacy signed nicknames, expired sessions and revoked sessions are rejected", %{
    conn: conn
  } do
    old = Phoenix.Token.sign(WaystoneWeb.Endpoint, "desktop", "Ada")

    conn
    |> put_req_header("authorization", "Bearer " <> old)
    |> get("/api/me")
    |> json_response(401)

    user = Waystone.AccountsFixtures.user()
    token = Accounts.create_session(user)
    authenticated = put_req_header(conn, "authorization", "Bearer " <> token)
    authenticated |> delete("/api/session") |> json_response(200)
    authenticated |> get("/api/me") |> json_response(401)
    token = Accounts.create_session(user)

    Repo.update_all(Session,
      set: [expires_at: DateTime.add(DateTime.utc_now() |> DateTime.truncate(:second), -1)]
    )

    assert :error = Accounts.authenticate(token)
    assert :error = WaystoneWeb.UserSocket.connect(%{"token" => token}, %Phoenix.Socket{}, %{})
  end

  test "members edit only their profile and cannot promote themselves", %{conn: conn} do
    member = Waystone.AccountsFixtures.user()
    other = Waystone.AccountsFixtures.user()
    authenticated = auth(conn, member)

    profile =
      authenticated
      |> put("/api/me", %{
        display_name: "Wandering Mage",
        bio: "Raids and tea",
        avatar_color: "berry",
        role: "admin",
        id: other.id,
        username: "hijacked"
      })
      |> json_response(200)

    assert profile["display_name"] == "Wandering Mage"
    assert profile["username"] == member.username
    assert profile["role"] == "member"
    empty = authenticated |> put("/api/me", %{bio: ""}) |> json_response(200)
    assert empty["bio"] == ""
    authenticated |> put("/api/me", %{bio: nil}) |> json_response(422)
    assert Repo.get!(User, other.id).display_name == "Ada"
    authenticated |> put("/api/users/#{member.id}/role", %{role: "admin"}) |> json_response(403)
    authenticated |> put("/api/me", %{avatar_color: "javascript:alert(1)"}) |> json_response(422)
    authenticated |> put("/api/me", %{bio: String.duplicate("x", 281)}) |> json_response(422)
    authenticated |> get("/api/users/not-a-number") |> json_response(404)
    directory = authenticated |> get("/api/users") |> json_response(200)
    assert Enum.all?(directory["users"], &(not Map.has_key?(&1, "password_hash")))
  end

  test "roles are checked from the database on every management request", %{conn: conn} do
    member = Waystone.AccountsFixtures.user()
    moderator = Waystone.AccountsFixtures.user("moderator")
    admin = Waystone.AccountsFixtures.user("admin")
    member_conn = auth(conn, member)
    mod_conn = auth(conn, moderator)
    admin_conn = auth(conn, admin)
    member_conn |> post("/api/channels", %{name: "denied"}) |> json_response(403)
    channel = mod_conn |> post("/api/channels", %{name: "moderated"}) |> json_response(201)
    member_conn |> delete("/api/channels/#{channel["id"]}") |> json_response(403)
    mod_conn |> put("/api/users/#{member.id}/role", %{role: "moderator"}) |> json_response(403)
    admin_conn |> put("/api/users/#{moderator.id}/role", %{role: "member"}) |> json_response(200)
    mod_conn |> delete("/api/channels/#{channel["id"]}") |> json_response(403)
    admin_conn |> delete("/api/channels/#{channel["id"]}") |> json_response(200)
    admin_conn |> put("/api/users/#{admin.id}/role", %{role: "member"}) |> json_response(422)
    admin_conn |> put("/api/users/#{member.id}/role", %{role: "admin"}) |> json_response(200)
    admin_conn |> put("/api/users/#{admin.id}/role", %{role: "member"}) |> json_response(200)
    admin_conn |> post("/api/channels", %{name: "stale-admin"}) |> json_response(403)
  end

  test "messages record stable ownership and reject an injected author", %{conn: conn} do
    member = Waystone.AccountsFixtures.user()
    {:ok, channel} = Waystone.Chat.create_channel(%{name: "identity"})
    authenticated = auth(conn, member)

    message =
      authenticated
      |> post("/api/channels/#{channel.id}/messages", %{
        body: "hello",
        author: "Admin",
        user_id: 999
      })
      |> json_response(201)

    assert message["author"] == member.display_name
    assert message["user_id"] == member.id
    authenticated |> put("/api/me", %{display_name: "New Name"}) |> json_response(200)
    history = authenticated |> get("/api/channels/#{channel.id}/messages") |> json_response(200)
    assert [%{"user_id" => id, "author" => "Ada"}] = history["messages"]
    assert id == member.id

    next =
      authenticated
      |> post("/api/channels/#{channel.id}/messages", %{body: "after rename"})
      |> json_response(201)

    assert next["author"] == "New Name"
    assert next["user_id"] == id
  end

  test "password changes require the old password and revoke every session", %{conn: conn} do
    user = Waystone.AccountsFixtures.user()
    authenticated = auth(conn, user)
    other_token = Accounts.create_session(user)

    authenticated
    |> put("/api/me/password", %{
      current_password: "wrong-password",
      password: "another-long-password"
    })
    |> json_response(401)

    authenticated
    |> put("/api/me/password", %{current_password: "test-password-long", password: "short"})
    |> json_response(422)

    authenticated
    |> put("/api/me/password", %{
      current_password: "test-password-long",
      password: "another-long-password"
    })
    |> json_response(200)

    authenticated |> get("/api/me") |> json_response(401)
    assert :error = Accounts.authenticate(other_token)
    assert {:error, :credentials} = Accounts.login(user.username, "test-password-long")
    assert {:ok, _} = Accounts.login(user.username, "another-long-password")
  end

  test "authentication attempts are bounded with a retry response", %{conn: conn} do
    for _ <- 1..20, do: conn |> post("/api/session", %{}) |> json_response(401)
    response = conn |> post("/api/session", %{})
    assert json_response(response, 429)
    assert get_resp_header(response, "retry-after") == ["60"]
  end
end
