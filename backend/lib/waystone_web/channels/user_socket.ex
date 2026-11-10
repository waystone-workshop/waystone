defmodule WaystoneWeb.UserSocket do
  use Phoenix.Socket
  channel "directory", WaystoneWeb.ChatChannel
  channel "chat:*", WaystoneWeb.ChatChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Waystone.Accounts.authenticate(token) do
      {:ok, user} ->
        {:ok, socket |> assign(:author, user.display_name) |> assign(:session_token, token)}

      _ ->
        :error
    end
  end

  def connect(_, _, _), do: :error

  @impl true
  def id(socket), do: Waystone.Accounts.socket_id(socket.assigns.session_token)
end
