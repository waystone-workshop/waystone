defmodule WaystoneWeb.Presence do
  use Phoenix.Presence, otp_app: :waystone, pubsub_server: Waystone.PubSub
end
