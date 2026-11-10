defmodule Waystone.Repo.Migrations.AddProfileMediaAndVoiceRooms do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :avatar_version, :string
      add :avatar_content_type, :string
      add :banner_version, :string
      add :banner_content_type, :string
    end

    create table(:profile_media) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :kind, :string, null: false
      add :data, :binary, null: false
      add :content_type, :string, null: false
    end

    create unique_index(:profile_media, [:user_id, :kind])

    create table(:voice_rooms) do
      add :name, :string, null: false
      timestamps(type: :utc_datetime)
    end

    create unique_index(:voice_rooms, [:name])

    execute "INSERT INTO voice_rooms (name, inserted_at, updated_at) VALUES ('campfire', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            "DELETE FROM voice_rooms WHERE name = 'campfire'"
  end
end
