defmodule Waystone.MigrationRepo do
  use Ecto.Repo, otp_app: :waystone, adapter: Ecto.Adapters.SQLite3
end
