defmodule WaystoneWeb.ChatChannel do
  use WaystoneWeb, :channel

  @impl true
  def join("directory", _params, socket), do: authenticated_join(socket)

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
  def handle_info(:check_session, socket) do
    case Waystone.Accounts.authenticate(socket.assigns.session_token) do
      {:ok, _} ->
        Process.send_after(self(), :check_session, 60_000)
        {:noreply, socket}

      :error ->
        {:stop, :normal, socket}
    end
  end
end
