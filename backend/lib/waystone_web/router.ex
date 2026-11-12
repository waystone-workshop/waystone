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

  scope "/", WaystoneWeb do
    pipe_through :api
    get "/health", HealthController, :show
  end

  scope "/api", WaystoneWeb do
    pipe_through :api
    post "/session", AccountController, :login
    delete "/session", AccountController, :logout
    post "/register", AccountController, :register
    get "/me", AccountController, :me
    put "/me", AccountController, :update
    put "/me/password", AccountController, :password
    put "/me/media/:kind", AccountController, :upload_media
    delete "/me/media/:kind", AccountController, :delete_media
    get "/users/:id/media/:kind", AccountController, :media
    get "/voice-rooms", VoiceRoomController, :index
    post "/voice-rooms", VoiceRoomController, :create
    delete "/voice-rooms/:id", VoiceRoomController, :delete
    post "/voice-rooms/:id/call", VoiceRoomController, :join
    get "/users", AccountController, :users
    get "/users/:id", AccountController, :show
    put "/users/:id/role", AccountController, :role
    get "/channels", ApiController, :channels
    post "/channels/:id/call", ApiController, :join_call
    post "/channels", ApiController, :create_channel
    delete "/channels/:id", ApiController, :delete_channel
    get "/channels/:id/board", ApiController, :channel_board
    put "/channels/:id/board", ApiController, :save_channel_board
    get "/channels/:id/messages", ApiController, :messages
    post "/channels/:id/messages", ApiController, :send_message
    put "/messages/:id", ApiController, :update_message
    delete "/messages/:id", ApiController, :delete_message
    post "/messages/:id/reactions", ApiController, :react
    get "/server", ApiController, :server
    put "/server", ApiController, :update_server
    get "/expressions", ApiController, :expressions
    post "/expressions", ApiController, :create_expression
    get "/expressions/:id", ApiController, :expression
    delete "/expressions/:id", ApiController, :delete_expression
    post "/channels/:id/files", ApiController, :upload_file
    delete "/channels/:id/files/:file_id", ApiController, :discard_file
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
