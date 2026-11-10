defmodule Waystone.Repo.Migrations.AddAccountsAndSessions do
  use Ecto.Migration

  def change do
    create table(:users) do
      add :username, :string, null: false
      add :display_name, :string, null: false
      add :bio, :string, null: false, default: ""
      add :avatar_color, :string, null: false, default: "pine"
      add :password_hash, :string, null: false
      add :role, :string, null: false, default: "member"
      timestamps(type: :utc_datetime)
    end

    create unique_index(:users, [:username])

    create table(:user_sessions, primary_key: false) do
      add :token_hash, :binary, primary_key: true
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :expires_at, :utc_datetime, null: false
    end

    create index(:user_sessions, [:user_id])

    alter table(:messages) do
      add :user_id, references(:users, on_delete: :nilify_all)
    end

    create index(:messages, [:user_id])
  end
end
