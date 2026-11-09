defmodule Waystone.MigrationTest do
  use ExUnit.Case, async: false
  alias Waystone.MigrationRepo

  test "existing lobby messages migrate into general without losing identity or content" do
    database =
      Path.join(System.tmp_dir!(), "waystone-migration-#{System.unique_integer([:positive])}.db")

    on_exit(fn ->
      for suffix <- ["", "-wal", "-shm"], do: File.rm(database <> suffix)
    end)

    start_supervised!({MigrationRepo, database: database, pool_size: 1})
    path = Application.app_dir(:waystone, "priv/repo/migrations")
    Ecto.Migrator.run(MigrationRepo, path, :up, to: 20_261_030_214_500, log: false)

    Ecto.Adapters.SQL.query!(
      MigrationRepo,
      "INSERT INTO messages (id, author, body, inserted_at, updated_at) VALUES (42, 'Ada', 'Original idea', '2026-10-30 21:45:00', '2026-10-30 21:45:00')",
      []
    )

    Ecto.Migrator.run(MigrationRepo, path, :up, all: true, log: false)

    result =
      Ecto.Adapters.SQL.query!(
        MigrationRepo,
        "SELECT m.id, m.author, m.body, m.inserted_at, c.name, m.attachments FROM messages m JOIN channels c ON c.id = m.channel_id",
        []
      )

    assert [[42, "Ada", "Original idea", "2026-10-30 21:45:00", "general", "[]"]] = result.rows

    boards =
      Ecto.Adapters.SQL.query!(MigrationRepo, "SELECT id, channel_id FROM channel_boards", []).rows

    assert [[board_id, 1]] = boards
    assert {:ok, _} = Ecto.UUID.cast(board_id)

    assert_raise Exqlite.Error, ~r/immutable/, fn ->
      Ecto.Adapters.SQL.query!(MigrationRepo, "UPDATE channel_boards SET id = ? WHERE id = ?", [
        Ecto.UUID.generate(),
        board_id
      ])
    end
  end
end
