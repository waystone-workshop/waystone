defmodule Waystone.Repo.Migrations.ChannelOwnedBoards do
  use Ecto.Migration

  def up do
    create table(:channel_boards, primary_key: false) do
      add :id, :string, primary_key: true
      add :channel_id, references(:channels, on_delete: :delete_all), null: false
      add :title, :string, null: false

      add :content, :map,
        null: false,
        default: %{items: [], connectors: [], view: %{x: 60, y: 60, zoom: 1}}

      add :resources, :text, null: false, default: "[]"
      add :revision, :integer, null: false, default: 1
      timestamps(type: :utc_datetime)
    end

    create unique_index(:channel_boards, [:channel_id])

    uuid =
      "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))"

    execute "INSERT INTO channel_boards (id, channel_id, title, inserted_at, updated_at) SELECT #{uuid}, id, '#' || name || ' board', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM channels"

    execute """
    CREATE TRIGGER channels_create_board AFTER INSERT ON channels
    BEGIN
      INSERT INTO channel_boards (id, channel_id, title, inserted_at, updated_at)
      VALUES (#{uuid}, NEW.id, '#' || NEW.name || ' board', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    END
    """

    execute """
    CREATE TRIGGER channel_boards_owned_delete BEFORE DELETE ON channel_boards
    WHEN EXISTS (SELECT 1 FROM channels WHERE id = OLD.channel_id)
    BEGIN
      SELECT RAISE(ABORT, 'Delete the owning channel to delete its board');
    END
    """

    execute """
    CREATE TRIGGER channel_boards_owned_update BEFORE UPDATE OF id, channel_id ON channel_boards
    WHEN NEW.id != OLD.id OR NEW.channel_id != OLD.channel_id
    BEGIN
      SELECT RAISE(ABORT, 'Channel board ownership is immutable');
    END
    """
  end

  def down do
    execute "DROP TRIGGER channel_boards_owned_update"
    execute "DROP TRIGGER channel_boards_owned_delete"
    execute "DROP TRIGGER channels_create_board"
    drop table(:channel_boards)
  end
end
