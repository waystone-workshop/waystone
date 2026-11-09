defmodule WaystoneWeb.UserSocket do
  use Phoenix.Socket
  channel "directory", WaystoneWeb.ChatChannel
  channel "chat:*", WaystoneWeb.ChatChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Phoenix.Token.verify(WaystoneWeb.Endpoint, "desktop", token, max_age: 604_800) do
      {:ok, name} -> {:ok, assign(socket, :author, name)}
      _ -> :error
    end
  end

  def connect(_, _, _), do: :error

  @impl true
  def id(_socket), do: nil
end
