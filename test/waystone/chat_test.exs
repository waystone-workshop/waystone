defmodule Waystone.ChatTest do
  use Waystone.DataCase, async: false

  alias Waystone.Chat

  test "stores a trimmed message and lists messages in order" do
    assert {:ok, first} = Chat.create_message("Ada", %{"body" => " hello "})
    assert first.author == "Ada"
    assert first.body == "hello"

    assert {:ok, second} = Chat.create_message("Grace", %{"body" => "hi"})

    assert Chat.list_messages() |> Enum.map(& &1.id) == [first.id, second.id]
  end

  test "rejects a blank message" do
    assert {:error, changeset} = Chat.create_message("Ada", %{"body" => "   "})
    assert "can't be blank" in errors_on(changeset).body
  end

  test "accepts a trimmed name" do
    assert {:ok, "Ada"} = Chat.apply_name(%{"display_name" => "  Ada  "})
  end

  test "rejects an empty name" do
    assert {:error, changeset} = Chat.apply_name(%{"display_name" => "   "})
    assert "can't be blank" in errors_on(changeset).display_name
  end

  test "rejects a name that is too long" do
    assert {:error, changeset} = Chat.apply_name(%{"display_name" => String.duplicate("a", 25)})
    assert %{display_name: [_ | _]} = errors_on(changeset)
  end
end
