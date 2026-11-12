defmodule Waystone.Repo.Migrations.AddRepliesEditsAndExpressions do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :reply_to_id, references(:messages, on_delete: :nilify_all)
      add :edited_at, :utc_datetime
    end

    create index(:messages, [:reply_to_id])

    create table(:expressions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :kind, :string, null: false
      add :name, :string, null: false
      add :content_type, :string, null: false
      add :byte_size, :integer, null: false
      add :user_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:expressions, [:kind, :name])
    create index(:expressions, [:user_id])
  end
end
