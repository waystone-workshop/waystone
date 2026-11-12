defmodule WaystoneWeb.ServerConfigTest do
  use ExUnit.Case, async: true

  defmodule Ok do
    @moduledoc false
    def init(opts), do: opts
    def call(conn, _opts), do: Plug.Conn.send_resp(conn, 204, "")
  end

  test "the http listener accepts its configured options" do
    http = :waystone |> Application.fetch_env!(WaystoneWeb.Endpoint) |> Keyword.get(:http, [])

    opts =
      http
      |> Keyword.put(:plug, Ok)
      |> Keyword.put(:port, 0)

    assert {:ok, server} = Bandit.start_link(opts)
    on_exit(fn -> Process.exit(server, :shutdown) end)
  end
end
