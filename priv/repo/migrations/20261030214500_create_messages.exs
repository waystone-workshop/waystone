defmodule Waystone.Repo.Migrations.CreateMessages do
  use Ecto.Migration

  def change do
    create table(:messages) do
      add :author, :string, null: false
      add :body, :text, null: false

      timestamps(type: :utc_datetime)
    end
  end
end
