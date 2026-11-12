defmodule Waystone.Repo.Migrations.CreateServerSettings do
  use Ecto.Migration

  def change do
    create table(:server_settings) do
      add :expression_uploads, :string, null: false, default: "member"
      add :emoji_max_bytes, :integer, null: false, default: 262_144
      add :sticker_max_bytes, :integer, null: false, default: 524_288
      add :expression_limit, :integer, null: false, default: 200

      timestamps(type: :utc_datetime)
    end

    execute """
            INSERT INTO server_settings (
              expression_uploads, emoji_max_bytes, sticker_max_bytes, expression_limit, inserted_at, updated_at
            ) VALUES (
              'member', 262144, 524288, 200, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """,
            "DELETE FROM server_settings"
  end
end
