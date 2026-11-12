defmodule Waystone.Repo.Migrations.CreateSharedFiles do
  use Ecto.Migration

  def change do
    create table(:shared_files, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :channel_id, references(:channels, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :nilify_all)
      add :message_id, references(:messages, on_delete: :delete_all)
      add :name, :string, null: false
      add :byte_size, :integer, null: false
      timestamps(type: :utc_datetime)
    end

    create index(:shared_files, [:channel_id])
    create index(:shared_files, [:message_id])
    create index(:shared_files, [:user_id])
  end
end
