defmodule WaystoneWeb.MessagesTest do
  use WaystoneWeb.ConnCase, async: false

  alias Waystone.{Accounts, Chat, Repo}
  alias Waystone.AccountsFixtures
  alias Waystone.Chat.{Expressions, Message}

  @png "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="

  setup do
    root = Expressions.root()
    File.rm_rf(root)
    on_exit(fn -> File.rm_rf(root) end)
    :ok
  end

  test "a reply quotes the earlier message in the same channel", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "talk-#{System.unique_integer([:positive])}"})
    {:ok, other} = Chat.create_channel(%{name: "other-#{System.unique_integer([:positive])}"})
    author = AccountsFixtures.user()
    token = Accounts.create_session(author)
    long = String.duplicate("word ", 40)

    {:ok, original} =
      Chat.send_message(channel.id, author, %{
        "body" => long,
        "attachments" => [%{"data" => @png}]
      })

    assert conn
           |> auth(token)
           |> post("/api/channels/#{other.id}/messages", %{
             "body" => "wrong room",
             "reply_to" => original.id
           })
           |> json_response(422) == %{"error" => "Reply to a message in this channel."}

    reply =
      conn
      |> auth(token)
      |> post("/api/channels/#{channel.id}/messages", %{
        "body" => "answering",
        "reply_to" => Integer.to_string(original.id)
      })
      |> json_response(201)

    assert reply["reply"]["id"] == original.id
    assert reply["reply"]["author"] == "Ada"
    assert reply["reply"]["body"] == String.slice(long, 0, 140)
    assert reply["reply"]["attachment"]["kind"] == "picture"
    refute Map.has_key?(reply["reply"]["attachment"], "data")

    history =
      conn |> auth(token) |> get("/api/channels/#{channel.id}/messages") |> json_response(200)

    loaded = Enum.find(history["messages"], &(&1["id"] == reply["id"]))
    assert loaded["reply"]["body"] == reply["reply"]["body"]
    refute inspect(loaded["reply"]) =~ @png
  end

  test "the author can edit, and a moderator can delete", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "edit-#{System.unique_integer([:positive])}"})
    author = AccountsFixtures.user()
    member = AccountsFixtures.user()
    moderator = AccountsFixtures.user("moderator")
    {:ok, message} = Chat.send_message(channel.id, author, %{"body" => "first draft"})
    {:ok, legacy} = Chat.send_message(channel.id, "Grace", %{"body" => "old note"})

    assert conn
           |> auth(Accounts.create_session(member))
           |> put("/api/messages/#{message.id}", %{"body" => "nope"})
           |> json_response(403)

    assert conn
           |> auth(Accounts.create_session(author))
           |> put("/api/messages/#{legacy.id}", %{"body" => "nope"})
           |> json_response(403)

    assert conn
           |> auth(Accounts.create_session(author))
           |> put("/api/messages/#{message.id}", %{"body" => "   "})
           |> json_response(422)

    updated =
      conn
      |> auth(Accounts.create_session(author))
      |> put("/api/messages/#{message.id}", %{"body" => " final "})
      |> json_response(200)

    assert updated["body"] == "final"
    assert updated["edited_at"]
    assert Repo.get!(Message, message.id).body == "final"

    assert conn
           |> auth(Accounts.create_session(member))
           |> delete("/api/messages/#{message.id}")
           |> json_response(403)

    assert conn
           |> auth(Accounts.create_session(author))
           |> delete("/api/messages/#{message.id}")
           |> json_response(200) == %{"ok" => true}

    assert conn
           |> auth(Accounts.create_session(moderator))
           |> delete("/api/messages/#{legacy.id}")
           |> json_response(200) == %{"ok" => true}

    refute Repo.get(Message, message.id)
    refute Repo.get(Message, legacy.id)
  end

  test "deleting the quoted message clears the quote and keeps the reply", %{conn: conn} do
    {:ok, channel} = Chat.create_channel(%{name: "quote-#{System.unique_integer([:positive])}"})
    author = AccountsFixtures.user()
    {:ok, original} = Chat.send_message(channel.id, author, %{"body" => "the point"})

    {:ok, reply} =
      Chat.send_message(channel.id, author, %{"body" => "yes", "reply_to" => original.id})

    assert :ok = Chat.delete_message(author, original.id)
    assert Repo.get!(Message, reply.id).reply_to_id == nil

    history =
      conn
      |> auth(Accounts.create_session(author))
      |> get("/api/channels/#{channel.id}/messages")
      |> json_response(200)

    loaded = Enum.find(history["messages"], &(&1["id"] == reply.id))
    assert loaded["body"] == "yes"
    assert loaded["reply"] == nil
  end

  test "members can add emoji and stickers, and a moderator can remove them", %{conn: conn} do
    author = AccountsFixtures.user()
    member = AccountsFixtures.user()
    moderator = AccountsFixtures.user("moderator")
    token = Accounts.create_session(author)
    {:ok, channel} = Chat.create_channel(%{name: "shelf-#{System.unique_integer([:positive])}"})

    assert build_conn() |> get("/api/expressions") |> json_response(401)

    emoji =
      conn
      |> auth(token)
      |> post("/api/expressions", %{"kind" => "emoji", "name" => "Blob_Cat", "data" => @png})
      |> json_response(201)

    assert emoji["name"] == "blob_cat"
    assert emoji["kind"] == "emoji"
    assert File.regular?(Path.join(Expressions.root(), emoji["id"]))

    assert conn
           |> auth(token)
           |> post("/api/expressions", %{"kind" => "emoji", "name" => "blob_cat", "data" => @png})
           |> json_response(422) == %{"error" => "That name is already used."}

    assert conn
           |> auth(token)
           |> post("/api/expressions", %{"kind" => "emoji", "name" => "no space", "data" => @png})
           |> json_response(422)

    listed = conn |> auth(token) |> get("/api/expressions") |> json_response(200)
    assert Enum.any?(listed["emoji"], &(&1["name"] == "blob_cat"))
    refute Map.has_key?(hd(listed["emoji"]), "data")

    image =
      conn
      |> auth(token)
      |> get("/api/expressions/#{emoji["id"]}")

    assert get_resp_header(image, "x-content-type-options") == ["nosniff"]
    assert <<137, 80, 78, 71, _::binary>> = response(image, 200)

    sticker =
      conn
      |> auth(token)
      |> post("/api/expressions", %{"kind" => "sticker", "name" => "wave", "data" => @png})
      |> json_response(201)

    sent =
      conn
      |> auth(token)
      |> post("/api/channels/#{channel.id}/messages", %{
        "body" => "",
        "attachments" => [%{"kind" => "sticker", "expression_id" => sticker["id"]}]
      })
      |> json_response(201)

    assert sent["body"] == ""
    assert [%{"kind" => "sticker", "name" => "wave", "id" => id}] = sent["attachments"]
    assert id == sticker["id"]
    refute Map.has_key?(hd(sent["attachments"]), "data")

    {exported, messages} = Chat.Export.selection(channel.id, %{}, false)
    assert {:ok, _} = Chat.Export.bundle(exported, messages)
    assert Chat.Export.markdown(exported, messages) =~ ":wave: sticker"

    assert conn
           |> auth(Accounts.create_session(member))
           |> delete("/api/expressions/#{emoji["id"]}")
           |> json_response(403)

    assert conn
           |> auth(Accounts.create_session(moderator))
           |> delete("/api/expressions/#{emoji["id"]}")
           |> json_response(200)

    refute File.exists?(Path.join(Expressions.root(), emoji["id"]))

    missing =
      conn
      |> auth(token)
      |> post("/api/channels/#{channel.id}/messages", %{
        "attachments" => [%{"kind" => "sticker", "expression_id" => emoji["id"]}]
      })
      |> json_response(422)

    assert missing["error"] == "That sticker is no longer available."
  end

  defp auth(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)
end
