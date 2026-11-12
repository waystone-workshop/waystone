defmodule WaystoneWeb.SharedFilesTest do
  use WaystoneWeb.ConnCase, async: false

  alias Waystone.{Accounts, Chat}
  alias Waystone.Chat.Files

  setup do
    config = Application.fetch_env!(:waystone, Waystone.Chat.Files)

    on_exit(fn ->
      Application.put_env(:waystone, Waystone.Chat.Files, config)
      File.rm_rf(config[:root])
    end)

    {:ok, config: config}
  end

  test "a member can share a file and someone else can save it", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "files-#{System.unique_integer([:positive])}"})
    owner = Waystone.AccountsFixtures.user()
    reader = Waystone.AccountsFixtures.user()
    owner_token = Accounts.create_session(owner)
    reader_token = Accounts.create_session(reader)
    contents = "secret-file-contents"

    assert build_conn()
           |> put_req_header("content-type", "application/octet-stream")
           |> post("/api/channels/#{channel.id}/files", contents)
           |> json_response(401)

    uploaded =
      conn
      |> auth(owner_token)
      |> put_req_header("content-type", "application/octet-stream")
      |> put_req_header("x-file-name", URI.encode("notes/../../plans.txt"))
      |> post("/api/channels/#{channel.id}/files", contents)
      |> json_response(200)

    assert uploaded["name"] == "plans.txt"
    assert uploaded["byte_size"] == byte_size(contents)
    assert File.read!(Path.join(Files.root(), uploaded["id"])) == contents

    stolen =
      conn
      |> auth(reader_token)
      |> post("/api/channels/#{channel.id}/messages", %{
        "attachments" => [%{"kind" => "file", "file_id" => uploaded["id"]}]
      })
      |> json_response(422)

    assert stolen["error"] == "That file is no longer available."

    message =
      conn
      |> auth(owner_token)
      |> post("/api/channels/#{channel.id}/messages", %{
        "attachments" => [%{"kind" => "file", "file_id" => uploaded["id"]}]
      })
      |> json_response(201)

    [attachment] = message["attachments"]
    assert attachment["kind"] == "file"
    assert attachment["name"] == "plans.txt"
    assert attachment["byte_size"] == byte_size(contents)
    refute Map.has_key?(attachment, "data")

    assert conn
           |> auth(owner_token)
           |> post("/api/channels/#{channel.id}/messages", %{
             "attachments" => [%{"kind" => "file", "file_id" => uploaded["id"]}]
           })
           |> json_response(422)

    history =
      conn |> auth(reader_token) |> get("/api/channels/#{channel.id}/messages") |> response(200)

    refute history =~ contents

    download =
      conn
      |> auth(reader_token)
      |> get("/api/messages/#{message["id"]}/attachments/#{attachment["id"]}")

    assert response(download, 200) == contents
    assert get_resp_header(download, "x-content-type-options") == ["nosniff"]
    [type] = get_resp_header(download, "content-type")
    assert type =~ "application/octet-stream"
    refute type =~ "html"
    [disposition] = get_resp_header(download, "content-disposition")
    assert disposition =~ "attachment"
    assert disposition =~ "plans.txt"

    export =
      conn
      |> auth(reader_token)
      |> get(
        "/api/channels/#{channel.id}/export?format=zip&from=#{message["id"]}&to=#{message["id"]}"
      )

    {:ok, files} = :zip.extract(response(export, 200), [:memory])
    {~c"conversation.md", markdown} = List.keyfind(files, ~c"conversation.md", 0)
    assert markdown =~ "plans.txt"
    assert markdown =~ "not included in this export"
    refute markdown =~ contents
    refute Enum.any?(files, fn {_name, bytes} -> bytes =~ contents end)
  end

  test "an unsent file can be discarded and an oversized upload is refused", %{
    conn: conn,
    config: config
  } do
    {:ok, channel} = Chat.create_channel(%{name: "limits-#{System.unique_integer([:positive])}"})
    token = Accounts.create_session(Waystone.AccountsFixtures.user())

    uploaded =
      conn
      |> auth(token)
      |> put_req_header("content-type", "application/octet-stream")
      |> put_req_header("x-file-name", "note.txt")
      |> post("/api/channels/#{channel.id}/files", "keep-me")
      |> json_response(200)

    assert conn
           |> auth(token)
           |> delete("/api/channels/#{channel.id}/files/#{uploaded["id"]}")
           |> json_response(200) == %{"ok" => true}

    refute File.exists?(Path.join(Files.root(), uploaded["id"]))

    assert conn
           |> auth(token)
           |> post("/api/channels/#{channel.id}/messages", %{
             "attachments" => [%{"kind" => "file", "file_id" => uploaded["id"]}]
           })
           |> json_response(422)

    Application.put_env(:waystone, Waystone.Chat.Files, Keyword.put(config, :max_bytes, 4))

    assert conn
           |> auth(token)
           |> put_req_header("content-type", "application/octet-stream")
           |> post("/api/channels/#{channel.id}/files", "12345")
           |> json_response(422) == %{"error" => "That file is too large."}

    assert conn
           |> auth(token)
           |> put_req_header("content-type", "application/octet-stream")
           |> put_req_header("content-length", "0")
           |> post("/api/channels/#{channel.id}/files", "")
           |> json_response(422) == %{"error" => "Choose a file that isn't empty."}

    leftovers =
      case File.ls(Files.root()) do
        {:ok, names} -> names
        {:error, :enoent} -> []
      end

    refute Enum.any?(leftovers, &(not String.starts_with?(&1, "incoming-")))
  end

  test "deleting a channel removes its files", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "gone-#{System.unique_integer([:positive])}"})
    token = Accounts.create_session(Waystone.AccountsFixtures.user())

    uploaded =
      conn
      |> auth(token)
      |> put_req_header("content-type", "application/octet-stream")
      |> post("/api/channels/#{channel.id}/files", "channel-file")
      |> json_response(200)

    path = Path.join(Files.root(), uploaded["id"])
    assert File.exists?(path)
    assert {:ok, _} = Chat.delete_channel(channel.id)
    refute File.exists?(path)
  end

  defp auth(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)
end
