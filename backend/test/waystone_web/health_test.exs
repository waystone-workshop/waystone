defmodule WaystoneWeb.HealthTest do
  use WaystoneWeb.ConnCase, async: true

  test "readiness checks the database without returning credentials", %{conn: conn} do
    assert conn |> get("/health") |> json_response(200) == %{"status" => "ok"}
  end
end
