defmodule WaystoneWeb.NameHook do
  @moduledoc false

  use WaystoneWeb, :verified_routes

  import Phoenix.Component
  import Phoenix.LiveView

  def on_mount(:require_name, _params, session, socket) do
    case session["display_name"] do
      name when is_binary(name) and name != "" ->
        {:cont, assign(socket, :display_name, name)}

      _ ->
        {:halt, redirect(socket, to: ~p"/join")}
    end
  end
end
