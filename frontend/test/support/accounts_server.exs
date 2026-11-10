# Isolated real Phoenix API for the desktop accounts integration test.
Application.load(:waystone)
Application.put_env(:waystone, Waystone.Repo,
  database: System.fetch_env!("WAYSTONE_ACCOUNT_TEST_DB"), pool_size: 1)
endpoint = Application.get_env(:waystone, WaystoneWeb.Endpoint)
Application.put_env(:waystone, WaystoneWeb.Endpoint,
  Keyword.merge(endpoint, server: true, code_reloader: false, watchers: [],
    http: [ip: {127, 0, 0, 1}, port: String.to_integer(System.fetch_env!("PORT"))]))
{:ok, _} = Application.ensure_all_started(:waystone)
Ecto.Migrator.run(Waystone.Repo, Application.app_dir(:waystone, "priv/repo/migrations"), :up, all: true)
{:ok, _} = Waystone.Accounts.register(%{
  "username" => "test_admin", "display_name" => "Test Admin",
  "password" => System.fetch_env!("WAYSTONE_ACCOUNT_TEST_PASSWORD"),
  "invite_code" => System.fetch_env!("WAYSTONE_INVITE_CODE")})
{:ok, _} = Waystone.Accounts.promote_admin("test_admin")
IO.puts("ACCOUNTS_TEST_READY")
receive do
  :stop -> :ok
end
