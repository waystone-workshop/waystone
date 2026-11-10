defmodule WaystoneWeb.ApiTest do
  use WaystoneWeb.ConnCase, async: false
  alias Waystone.Chat

  defp authenticated(conn) do
    token = Waystone.AccountsFixtures.token()
    put_req_header(conn, "authorization", "Bearer " <> token)
  end

  test "history, attachments and exports require a token", %{conn: conn} do
    for path <- [
          "/api/channels",
          "/api/channels/1/messages",
          "/api/channels/1/export",
          "/api/messages/1/attachments/nope"
        ] do
      assert conn |> get(path) |> json_response(401)
    end
  end

  test "invite code is enforced", %{conn: conn} do
    previous = Application.get_env(:waystone, :invite_code)
    Application.put_env(:waystone, :invite_code, "friends-only")

    on_exit(fn ->
      if previous,
        do: Application.put_env(:waystone, :invite_code, previous),
        else: Application.delete_env(:waystone, :invite_code)
    end)

    assert conn
           |> post("/api/register", %{
             username: "ada",
             display_name: "Ada",
             password: "long-password-123",
             invite_code: "wrong"
           })
           |> json_response(401)

    assert %{"token" => token} =
             conn
             |> post("/api/register", %{
               username: "ada",
               display_name: "Ada",
               password: "long-password-123",
               invite_code: "friends-only"
             })
             |> json_response(201)

    assert is_binary(token)
  end

  test "channel messages stay isolated and history is paginated", %{conn: conn} do
    {:ok, one} = Chat.create_channel(%{name: "one"})
    {:ok, two} = Chat.create_channel(%{name: "two"})
    {:ok, first} = Chat.send_message(one.id, "Ada", %{"body" => "first"})
    {:ok, second} = Chat.send_message(one.id, "Ada", %{"body" => "second"})
    {:ok, _} = Chat.send_message(two.id, "Grace", %{"body" => "other channel"})

    result =
      conn
      |> authenticated()
      |> get("/api/channels/#{one.id}/messages?before=#{second.id}")
      |> json_response(200)

    assert Enum.map(result["messages"], & &1["id"]) == [first.id]
  end

  test "empty image-only drawing and portable export", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "plans"})

    png =
      Base.decode64!(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
      )

    canvas_id = Ecto.UUID.generate()

    attrs = %{
      "attachments" => [
        %{
          "kind" => "drawing",
          "data" => Base.encode64(png),
          "canvas_id" => canvas_id,
          "canvas_revision" => 2
        }
      ]
    }

    response =
      conn
      |> authenticated()
      |> post("/api/channels/#{channel.id}/messages", attrs)
      |> json_response(201)

    [attachment] = response["attachments"]
    assert attachment["canvas_id"] == canvas_id
    assert attachment["canvas_revision"] == 2
    refute Map.has_key?(attachment, "data")

    history =
      conn |> authenticated() |> get("/api/channels/#{channel.id}/messages") |> json_response(200)

    assert [%{"attachments" => [history_attachment]}] = history["messages"]
    assert history_attachment == attachment

    image =
      conn
      |> authenticated()
      |> get("/api/messages/#{response["id"]}/attachments/#{attachment["id"]}")

    assert response(image, 200) == png
    {:ok, ignored} = Chat.send_message(channel.id, "Grace", %{"body" => "outside selection"})

    export =
      conn
      |> authenticated()
      |> get(
        "/api/channels/#{channel.id}/export?format=zip&from=#{response["id"]}&to=#{response["id"]}"
      )

    {:ok, files} = :zip.extract(response(export, 200), [:memory])
    assert {~c"conversation.md", markdown} = List.keyfind(files, ~c"conversation.md", 0)
    assert markdown =~ "Ada"
    assert markdown =~ canvas_id
    assert markdown =~ "snapshot revision 2"
    assert markdown =~ response["inserted_at"]
    assert markdown =~ "attachments/#{attachment["name"]}"
    refute markdown =~ "Message #{ignored.id}"

    assert {_, ^png} =
             List.keyfind(files, String.to_charlist("attachments/" <> attachment["name"]), 0)
  end

  test "invalid image bytes are rejected", %{conn: conn} do
    attrs = %{"attachments" => [%{"data" => Base.encode64("not an image")}]}

    assert conn
           |> authenticated()
           |> post("/api/channels/1/messages", attrs)
           |> json_response(422)
  end

  test "whole-channel context includes history beyond the initial page", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "long-history"})
    for n <- 1..105, do: Chat.send_message(channel.id, "Ada", %{"body" => "idea #{n}"})

    history =
      conn |> authenticated() |> get("/api/channels/#{channel.id}/messages") |> json_response(200)

    assert length(history["messages"]) == 100

    export =
      conn |> authenticated() |> get("/api/channels/#{channel.id}/export") |> json_response(200)

    assert export["count"] == 105
    assert export["markdown"] =~ "idea 1"
    assert export["markdown"] =~ "idea 105"
  end

  test "invalid export ranges produce a useful error", %{conn: conn} do
    assert conn
           |> authenticated()
           |> get("/api/channels/1/export?from=invalid")
           |> json_response(422)
  end

  test "an empty preview snapshot stays empty after later messages arrive", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "snapshot"})

    preview =
      conn |> authenticated() |> get("/api/channels/#{channel.id}/export") |> json_response(200)

    assert preview["through"] == 0
    Chat.send_message(channel.id, "Ada", %{"body" => "later"})

    frozen =
      conn
      |> authenticated()
      |> get("/api/channels/#{channel.id}/export?to=0")
      |> json_response(200)

    assert frozen["count"] == 0
  end

  test "malformed Canvas references cannot be attached", %{conn: conn} do
    png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="

    attrs = %{
      "attachments" => [%{"data" => png, "canvas_id" => "not-an-id", "canvas_revision" => 1}]
    }

    assert conn
           |> authenticated()
           |> post("/api/channels/1/messages", attrs)
           |> json_response(422)
  end
end
