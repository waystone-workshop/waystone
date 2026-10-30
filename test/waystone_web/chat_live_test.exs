defmodule WaystoneWeb.ChatLiveTest do
  use WaystoneWeb.ConnCase, async: false

  import Phoenix.LiveViewTest

  test "people in the room see a text message", %{conn: conn} do
    {:ok, ada, ada_html} = live(named(conn, "Ada"), ~p"/")
    {:ok, grace, _grace_html} = live(named(build_conn(), "Grace"), ~p"/")

    assert ada_html =~ "Ada"

    ada
    |> form("#composer", %{message: %{body: "hello"}})
    |> render_submit()

    assert render(ada) =~ "hello"
    assert render(grace) =~ "hello"
    assert render(grace) =~ "Ada"
  end

  test "a blank message stays out of the room", %{conn: conn} do
    {:ok, view, _html} = live(named(conn, "Ada"), ~p"/")

    html =
      view
      |> form("#composer", %{message: %{body: "   "}})
      |> render_submit()

    assert html =~ "blank"
    assert html =~ "No messages yet"
  end

  defp named(conn, name) do
    conn
    |> init_test_session(%{})
    |> put_session(:display_name, name)
  end
end
