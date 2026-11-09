defmodule WaystoneWeb.HealthController do
  use WaystoneWeb, :controller

  def show(conn, _params) do
    case Ecto.Adapters.SQL.query(Waystone.Repo, "SELECT 1", []) do
      {:ok, _} -> json(conn, %{status: "ok"})
      {:error, _} -> conn |> put_status(503) |> json(%{status: "unavailable"})
    end
  end
end
