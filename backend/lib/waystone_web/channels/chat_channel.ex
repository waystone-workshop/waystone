defmodule WaystoneWeb.ChatChannel do
  use WaystoneWeb, :channel

  @impl true
  def join("directory", _params, socket), do: {:ok, socket}

  def join("chat:" <> id, _params, socket) do
    case Integer.parse(id) do
      {n, ""} when n > 0 ->
        if Waystone.Repo.get(Waystone.Chat.Channel, n),
          do: {:ok, socket},
          else: {:error, %{reason: "Unknown channel"}}

      _ ->
        {:error, %{reason: "Unknown channel"}}
    end
  end
end
