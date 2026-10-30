defmodule WaystoneWeb.SessionControllerTest do
  use WaystoneWeb.ConnCase, async: false

  test "asks for a name before the room", %{conn: conn} do
    conn = get(conn, ~p"/")
    assert redirected_to(conn) == ~p"/join"
  end

  test "join page renders the name form", %{conn: conn} do
    conn = get(conn, ~p"/join")
    assert html_response(conn, 200) =~ "Join the room"
  end

  test "stores a trimmed name for this browser session", %{conn: conn} do
    conn = post(conn, ~p"/join", %{session: %{display_name: "  Ada  "}})
    assert redirected_to(conn) == ~p"/"
    assert get_session(conn, :display_name) == "Ada"
  end

  test "rejects a blank name", %{conn: conn} do
    conn = post(conn, ~p"/join", %{session: %{display_name: "   "}})
    assert html_response(conn, 422) =~ "blank"
  end

  test "change name clears the session", %{conn: conn} do
    conn = post(conn, ~p"/join", %{session: %{display_name: "Ada"}})
    conn = delete(recycle(conn), ~p"/join")

    assert redirected_to(conn) == ~p"/join"
    assert get_session(conn, :display_name) == nil
  end
end
