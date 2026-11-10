defmodule WaystoneWeb.VoiceRoomController do
  use WaystoneWeb, :controller
  alias Waystone.{Repo, VoiceRoom}
  import Ecto.Query
  plug WaystoneWeb.Authenticate
  plug :require_manager when action in [:create, :delete]

  def index(conn, _),
    do:
      json(conn, %{rooms: Repo.all(from r in VoiceRoom, order_by: r.id) |> Enum.map(&room_json/1)})

  def create(conn, params) do
    case %VoiceRoom{} |> VoiceRoom.changeset(params) |> Repo.insert() do
      {:ok, room} ->
        WaystoneWeb.Endpoint.broadcast("directory", "voice_rooms_updated", %{})
        conn |> put_status(201) |> json(room_json(room))

      _ ->
        conn
        |> put_status(422)
        |> json(%{
          error:
            "Use a unique room name: lowercase letters, numbers and hyphens (up to 40 characters)."
        })
    end
  end

  def delete(conn, %{"id" => id}) do
    case room(id) do
      nil ->
        conn |> put_status(404) |> json(%{error: "Voice room not found."})

      room ->
        Repo.delete!(room)
        WaystoneWeb.Endpoint.broadcast("directory", "voice_rooms_updated", %{deleted_id: room.id})
        json(conn, %{deleted: true})
    end
  end

  def join(conn, %{"id" => id}) do
    with %VoiceRoom{} = room <- room(id),
         {:ok, credentials} <- Waystone.Calls.join_voice(room, conn.assigns.current_user) do
      json(conn, credentials)
    else
      nil ->
        conn |> put_status(404) |> json(%{error: "Voice room not found."})

      _ ->
        conn
        |> put_status(503)
        |> json(%{error: "Audio calls are not configured on this server."})
    end
  end

  defp room(id) do
    case Integer.parse(id) do
      {id, ""} when id > 0 -> Repo.get(VoiceRoom, id)
      _ -> nil
    end
  end

  defp room_json(room), do: Map.take(room, [:id, :name])

  defp require_manager(conn, _) do
    if Waystone.Accounts.manage_channels?(conn.assigns.current_user),
      do: conn,
      else:
        conn
        |> put_status(403)
        |> json(%{error: "Only admins and moderators can manage voice rooms."})
        |> halt()
  end
end
