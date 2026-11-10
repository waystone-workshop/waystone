defmodule Waystone.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      WaystoneWeb.Telemetry,
      Waystone.Repo,
      {Waystone.Accounts.AuthLimiter, name: Waystone.Accounts.AuthLimiter},
      {Ecto.Migrator,
       repos: Application.fetch_env!(:waystone, :ecto_repos), skip: skip_migrations?()},
      {Phoenix.PubSub, name: Waystone.PubSub},
      # Start a worker by calling: Waystone.Worker.start_link(arg)
      # {Waystone.Worker, arg},
      # Start to serve requests, typically the last entry
      WaystoneWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Waystone.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    WaystoneWeb.Endpoint.config_change(changed, removed)
    :ok
  end

  defp skip_migrations?() do
    # By default, sqlite migrations are run when using a release
    System.get_env("RELEASE_NAME") == nil
  end
end
