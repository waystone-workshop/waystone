defmodule WaystoneWeb.ChatChannelTest do
  use Waystone.DataCase, async: false
  import Phoenix.ChannelTest
  @endpoint WaystoneWeb.Endpoint

  test "socket requires a token and receives only its channel's messages" do
    assert :error = connect(WaystoneWeb.UserSocket, %{})
    token = Phoenix.Token.sign(@endpoint, "desktop", "Ada")
    {:ok, socket} = connect(WaystoneWeb.UserSocket, %{"token" => token})
    {:ok, channel} = Waystone.Chat.create_channel(%{name: "socket-room"})
    {:ok, other} = Waystone.Chat.create_channel(%{name: "elsewhere"})
    {:ok, _, _socket} = subscribe_and_join(socket, WaystoneWeb.ChatChannel, "chat:#{channel.id}")

    {:ok, _} =
      Waystone.Chat.send_message(other.id, "Grace", %{"body" => "private-to-other-channel"})

    {:ok, message} = Waystone.Chat.send_message(channel.id, "Grace", %{"body" => "hello"})
    assert_push "message", %{id: id, body: "hello"}
    assert id == message.id
    refute_push "message", %{body: "private-to-other-channel"}
  end
end
