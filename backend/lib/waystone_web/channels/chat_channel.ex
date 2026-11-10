defmodule WaystoneWeb.ChatChannel do
  use WaystoneWeb, :channel

  @impl true
  def join("directory", _params, socket) do
    send(self(), :track_presence)
    authenticated_join(socket)
  end

  def join("chat:" <> id, _params, socket) do
    case Integer.parse(id) do
      {n, ""} when n > 0 ->
        if Waystone.Repo.get(Waystone.Chat.Channel, n),
          do: authenticated_join(socket),
          else: {:error, %{reason: "Unknown channel"}}

      _ ->
        {:error, %{reason: "Unknown channel"}}
    end
  end

  defp authenticated_join(socket) do
    case Waystone.Accounts.authenticate(socket.assigns.session_token) do
      {:ok, _} ->
        Process.send_after(self(), :check_session, 60_000)
        {:ok, socket}

      :error ->
        {:error, %{reason: "Please sign in again"}}
    end
  end

  @impl true
  def handle_info(:track_presence, socket) do
    {:ok, _} =
      WaystoneWeb.Presence.track(socket, to_string(socket.assigns.user_id), %{
        voice_room_id: nil,
        muted: false,
        speaking: false
      })

    push(socket, "presence_state", WaystoneWeb.Presence.list(socket))
    {:noreply, socket}
  end

  def handle_info(:check_session, socket) do
    case Waystone.Accounts.authenticate(socket.assigns.session_token) do
      {:ok, _} ->
        Process.send_after(self(), :check_session, 60_000)
        {:noreply, socket}

      :error ->
        {:stop, :normal, socket}
    end
  end

  @impl true
  def handle_in("voice_state", params, %{topic: "directory"} = socket) do
    room_id = params["voice_room_id"]

    valid =
      is_nil(room_id) or
        (is_integer(room_id) and not is_nil(Waystone.Repo.get(Waystone.VoiceRoom, room_id)))

    if valid do
      WaystoneWeb.Presence.update(socket, to_string(socket.assigns.user_id), fn meta ->
        Map.merge(meta, %{
          voice_room_id: room_id,
          muted: params["muted"] == true,
          speaking: params["speaking"] == true
        })
      end)

      {:reply, :ok, socket}
    else
      {:reply, {:error, %{reason: "Unknown voice room"}}, socket}
    end
  end
end
