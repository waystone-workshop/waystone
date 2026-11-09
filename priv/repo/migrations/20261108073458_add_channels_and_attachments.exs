defmodule Waystone.Repo.Migrations.AddChannelsAndAttachments do
  use Ecto.Migration

  def up do
    create table(:channels) do
      add :name, :string, null: false
      timestamps(type: :utc_datetime)
    end

    create unique_index(:channels, [:name])

    execute "INSERT INTO channels (id, name, inserted_at, updated_at) VALUES (1, 'general', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"

    # SQLite cannot ADD a REFERENCES column with a non-NULL default to a
    # populated table. Rebuild it transactionally, retaining every message ID.
    create table(:channel_messages) do
      add :author, :string, null: false
      add :body, :text, null: false
      add :channel_id, references(:channels), null: false, default: 1
      add :attachments, :text, null: false, default: "[]"
      timestamps(type: :utc_datetime)
    end

    execute "INSERT INTO channel_messages (id, author, body, channel_id, attachments, inserted_at, updated_at) SELECT id, author, body, 1, '[]', inserted_at, updated_at FROM messages"
    drop table(:messages)
    rename table(:channel_messages), to: table(:messages)
    create index(:messages, [:channel_id, :id])
  end

  def down do
    create table(:lobby_messages) do
      add :author, :string, null: false
      add :body, :text, null: false
      timestamps(type: :utc_datetime)
    end

    execute "INSERT INTO lobby_messages (id, author, body, inserted_at, updated_at) SELECT id, author, body, inserted_at, updated_at FROM messages"
    drop table(:messages)
    rename table(:lobby_messages), to: table(:messages)
    drop table(:channels)
  end
end
