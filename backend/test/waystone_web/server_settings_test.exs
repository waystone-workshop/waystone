defmodule WaystoneWeb.ServerSettingsTest do
  use WaystoneWeb.ConnCase, async: false

  alias Waystone.{Accounts, ServerSettings}
  alias Waystone.AccountsFixtures
  alias Waystone.Chat.Expressions

  @png "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="

  setup do
    root = Expressions.root()
    File.rm_rf(root)
    on_exit(fn -> File.rm_rf(root) end)
    :ok
  end

  test "an admin sets who may add emoji, and the shelf follows that", %{conn: conn} do
    member = AccountsFixtures.user()
    moderator = AccountsFixtures.user("moderator")
    admin = AccountsFixtures.user("admin")

    assert conn |> get("/api/server") |> json_response(401)

    loaded =
      conn |> auth(Accounts.create_session(member)) |> get("/api/server") |> json_response(200)

    assert loaded["expression_uploads"] == "member"
    assert loaded["emoji_max_bytes"] == 262_144

    assert conn
           |> auth(Accounts.create_session(member))
           |> put("/api/server", %{"expression_uploads" => "moderator"})
           |> json_response(403)

    saved =
      conn
      |> auth(Accounts.create_session(admin))
      |> put("/api/server", %{"expression_uploads" => "moderator"})
      |> json_response(200)

    assert saved["expression_uploads"] == "moderator"

    assert conn
           |> auth(Accounts.create_session(member))
           |> post("/api/expressions", %{"kind" => "emoji", "name" => "nope", "data" => @png})
           |> json_response(422) == %{"error" => "Only a moderator can add emoji and stickers."}

    assert conn
           |> auth(Accounts.create_session(moderator))
           |> post("/api/expressions", %{"kind" => "emoji", "name" => "mod_mark", "data" => @png})
           |> json_response(201)

    assert conn
           |> auth(Accounts.create_session(admin))
           |> put("/api/server", %{"expression_uploads" => "guests"})
           |> json_response(422) == %{"error" => "Choose who can add emoji and stickers."}
  end

  test "the configured emoji size is what an upload is measured against", %{conn: conn} do
    admin = AccountsFixtures.user("admin")
    token = Accounts.create_session(admin)

    assert conn
           |> auth(token)
           |> put("/api/server", %{"emoji_max_bytes" => 16 * 1024})
           |> json_response(200)

    oversized = Base.encode64(Base.decode64!(@png) <> :binary.copy(<<0>>, 20_000))

    assert conn
           |> auth(token)
           |> post("/api/expressions", %{"kind" => "emoji", "name" => "huge", "data" => oversized})
           |> json_response(422) == %{
             "error" => "Emoji are PNG, JPEG, GIF, or WebP images up to 16 KB."
           }

    assert ServerSettings.get!().emoji_max_bytes == 16 * 1024
  end

  defp auth(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)
end
