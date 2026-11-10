defmodule WaystoneWeb.Authenticate do
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]
  def init(opts), do: opts

  def call(conn, _) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, user} <- Waystone.Accounts.authenticate(token) do
      conn
      |> assign(:current_user, user)
      |> assign(:author, user.display_name)
      |> assign(:session_token, token)
    else
      _ -> conn |> put_status(401) |> json(%{error: "Please sign in again."}) |> halt()
    end
  end
end
