defmodule WaystoneWeb.Router do
  use WaystoneWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {WaystoneWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", WaystoneWeb do
    pipe_through :api
    post "/session", ApiController, :session
    get "/channels", ApiController, :channels
    post "/channels", ApiController, :create_channel
    delete "/channels/:id", ApiController, :delete_channel
    get "/channels/:id/board", ApiController, :channel_board
    put "/channels/:id/board", ApiController, :save_channel_board
    get "/channels/:id/messages", ApiController, :messages
    post "/channels/:id/messages", ApiController, :send_message
    get "/channels/:id/export", ApiController, :export
    get "/messages/:message_id/attachments/:attachment_id", ApiController, :attachment
  end

  # Other scopes may use custom stacks.
  # scope "/api", WaystoneWeb do
  #   pipe_through :api
  # end

  # Enable LiveDashboard in development
  if Application.compile_env(:waystone, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: WaystoneWeb.Telemetry
    end
  end
end
