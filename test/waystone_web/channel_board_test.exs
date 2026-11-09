defmodule WaystoneWeb.ChannelBoardTest do
  use WaystoneWeb.ConnCase, async: false
  alias Waystone.{Chat, Repo}
  alias Waystone.Chat.ChannelBoard
  import Ecto.Query

  defp authenticated(conn) do
    token = Phoenix.Token.sign(WaystoneWeb.Endpoint, "desktop", "Ada")
    put_req_header(conn, "authorization", "Bearer " <> token)
  end

  test "each channel, including general, owns exactly one board", %{conn: conn} do
    assert Chat.get_board!(1).channel_id == 1

    created =
      conn |> authenticated() |> post("/api/channels", %{name: "planning"}) |> json_response(201)

    assert {:ok, _} = Ecto.UUID.cast(created["board_id"])

    assert Repo.aggregate(from(b in ChannelBoard, where: b.channel_id == ^created["id"]), :count) ==
             1

    board =
      conn |> authenticated() |> get("/api/channels/#{created["id"]}/board") |> json_response(200)

    assert board["board"]["id"] == created["board_id"]
    assert board["board"]["content"]["items"] == []
    assert {:error, _} = Chat.create_channel(%{name: "planning"})
    assert Repo.aggregate(ChannelBoard, :count) == length(Chat.list_channels())
  end

  test "saving the shared board persists content and rejects stale or invalid saves", %{
    conn: conn
  } do
    {:ok, channel} = Chat.create_channel(%{name: "shared"})

    original =
      conn |> authenticated() |> get("/api/channels/#{channel.id}/board") |> json_response(200)

    board = put_in(original["board"]["title"], "Our plan")
    params = Map.put(board, "base_revision", 1)

    saved =
      conn
      |> authenticated()
      |> put("/api/channels/#{channel.id}/board", params)
      |> json_response(200)

    assert saved["board"]["revision"] == 2
    assert saved["board"]["title"] == "Our plan"

    assert conn
           |> authenticated()
           |> put("/api/channels/#{channel.id}/board", params)
           |> json_response(409)

    broken =
      params
      |> Map.put("base_revision", 2)
      |> put_in(["board", "content", "items"], [%{"id" => "broken"}])

    assert conn
           |> authenticated()
           |> put("/api/channels/#{channel.id}/board", broken)
           |> json_response(422)

    assert Chat.get_board!(channel.id).revision == 2
  end

  test "channel deletion cascades to its board and messages and broadcasts deletion", %{
    conn: conn
  } do
    {:ok, channel} = Chat.create_channel(%{name: "temporary"})
    board = Chat.get_board!(channel.id)
    {:ok, message} = Chat.send_message(channel.id, "Ada", %{"body" => "hello"})
    Phoenix.PubSub.subscribe(Waystone.PubSub, "directory")
    assert conn |> authenticated() |> delete("/api/channels/#{channel.id}") |> json_response(200)
    refute Repo.get(ChannelBoard, board.id)
    refute Repo.get(Chat.Message, message.id)
    refute Repo.get(Chat.Channel, channel.id)

    assert_receive %Phoenix.Socket.Broadcast{
      event: "channel_deleted",
      payload: %{id: id, board_id: board_id}
    }

    assert id == channel.id
    assert board_id == board.id
  end

  test "a board cannot be deleted independently of its channel" do
    {:ok, channel} = Chat.create_channel(%{name: "owned"})
    board = Chat.get_board!(channel.id)
    assert_raise Exqlite.Error, ~r/owning channel/, fn -> Repo.delete!(board) end
    assert Repo.get(ChannelBoard, board.id)
    assert Repo.get(Chat.Channel, channel.id)
  end

  test "board access, saves and channel deletion require authentication", %{conn: conn} do
    assert conn |> get("/api/channels/1/board") |> json_response(401)
    assert conn |> put("/api/channels/1/board", %{}) |> json_response(401)
    assert conn |> delete("/api/channels/1") |> json_response(401)
  end

  test "shared boards round-trip referenced image and editable drawing resources", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "resources"})

    original =
      conn |> authenticated() |> get("/api/channels/#{channel.id}/board") |> json_response(200)

    now = DateTime.utc_now() |> DateTime.to_iso8601()

    png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="

    image = %{
      "version" => 1,
      "id" => Ecto.UUID.generate(),
      "revision" => 1,
      "type" => "image",
      "title" => "Reference",
      "createdAt" => now,
      "updatedAt" => now,
      "content" => %{"dataURL" => "data:image/png;base64," <> png}
    }

    drawing = %{
      image
      | "id" => Ecto.UUID.generate(),
        "type" => "drawing",
        "content" => %{
          "width" => 1000,
          "height" => 600,
          "strokes" => [%{"color" => "#112233", "size" => 4, "points" => [[5, 5], [10, 10]]}]
        }
    }

    items =
      Enum.map([image, drawing], fn resource ->
        %{
          "id" => Ecto.UUID.generate(),
          "kind" => "canvas",
          "canvasId" => resource["id"],
          "x" => 0,
          "y" => 0,
          "width" => 300,
          "height" => 180,
          "rotation" => 0,
          "z" => 1
        }
      end)

    params =
      original
      |> put_in(["board", "content", "items"], items)
      |> Map.put("canvases", [image, drawing])
      |> Map.put("base_revision", 1)

    assert conn
           |> authenticated()
           |> put("/api/channels/#{channel.id}/board", params)
           |> json_response(200)

    retrieved =
      build_conn()
      |> authenticated()
      |> get("/api/channels/#{channel.id}/board")
      |> json_response(200)

    assert retrieved["canvases"] == [image, drawing]
    assert retrieved["board"]["content"]["items"] == items

    broken_drawing =
      put_in(drawing, ["content", "strokes"], [
        %{"color" => "#112233", "size" => 4, "points" => [[-1, 5]]}
      ])

    invalid =
      params |> Map.put("canvases", [image, broken_drawing]) |> Map.put("base_revision", 2)

    assert conn
           |> authenticated()
           |> put("/api/channels/#{channel.id}/board", invalid)
           |> json_response(422)
  end
end
