defmodule WaystoneWeb.PresenceTest do
  use Waystone.DataCase, async: false
  import Phoenix.ChannelTest
  @endpoint WaystoneWeb.Endpoint

  test "presence tracks authenticated accounts across devices and disconnects" do
    user = Waystone.AccountsFixtures.user()
    key = to_string(user.id)
    token = Waystone.Accounts.create_session(user)
    {:ok, first} = connect(WaystoneWeb.UserSocket, %{"token" => token})
    {:ok, _, first} = subscribe_and_join(first, WaystoneWeb.ChatChannel, "directory")
    assert_push "presence_state", state, 2000
    assert length(state[key].metas) == 1
    {:ok, second} = connect(WaystoneWeb.UserSocket, %{"token" => token})
    {:ok, _, _second} = subscribe_and_join(second, WaystoneWeb.ChatChannel, "directory")
    assert_push "presence_state", state, 2000
    assert length(state[key].metas) == 2
    room = Waystone.Repo.get_by!(Waystone.VoiceRoom, name: "campfire")

    ref =
      push(first, "voice_state", %{
        "voice_room_id" => room.id,
        "muted" => true,
        "speaking" => false,
        "user_id" => 999
      })

    assert_reply ref, :ok

    assert Enum.any?(
             WaystoneWeb.Presence.list("directory")[key].metas,
             &(&1.voice_room_id == room.id && &1.muted)
           )

    ref = push(first, "voice_state", %{"voice_room_id" => -1})
    assert_reply ref, :error
    monitor = Process.monitor(first.channel_pid)
    Process.unlink(first.channel_pid)
    leave(first)
    assert_receive {:DOWN, ^monitor, :process, _, _}
    assert_push "presence_diff", %{leaves: %{^key => _}}, 2000
    assert length(WaystoneWeb.Presence.list("directory")[key].metas) == 1
  end
end
