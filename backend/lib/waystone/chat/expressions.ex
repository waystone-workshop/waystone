defmodule Waystone.Chat.Expressions do
  @moduledoc """
  Custom emoji and stickers for the room. The bytes live beside the database.
  A message stores a sticker's name, or an emoji's `:name:` in its text.
  """

  import Ecto.Query

  alias Waystone.Chat.Expression
  alias Waystone.Repo
  alias Waystone.ServerSettings

  @name ~r/^[a-z0-9_]{2,32}$/

  def list do
    rows = Repo.all(from e in Expression, order_by: [asc: e.name])

    %{
      emoji: Enum.map(Enum.filter(rows, &(&1.kind == "emoji")), &public/1),
      stickers: Enum.map(Enum.filter(rows, &(&1.kind == "sticker")), &public/1)
    }
  end

  def create(user, params) do
    kind = params["kind"]
    settings = ServerSettings.get!()

    with :ok <- authorize(user, settings),
         true <- kind in ["emoji", "sticker"],
         {:ok, name} <- normalize_name(params["name"]),
         {:ok, bytes, mime, _ext} <-
           Waystone.Media.decode_image(params["data"] || "", max_bytes(settings, kind)),
         :ok <- within_limit(settings, kind) do
      id = Ecto.UUID.generate()
      path = Path.join(root(), id)
      File.mkdir_p!(root())
      File.write!(path, bytes)

      case %Expression{}
           |> Expression.changeset(%{
             id: id,
             kind: kind,
             name: name,
             content_type: mime,
             byte_size: byte_size(bytes),
             user_id: user.id
           })
           |> Repo.insert() do
        {:ok, expression} ->
          {:ok, expression}

        {:error, changeset} ->
          File.rm(path)
          {:error, name_error(changeset)}
      end
    else
      false -> {:error, "Choose an emoji or a sticker."}
      {:error, reason} when is_binary(reason) -> {:error, reason}
      {:error, :invalid_image} -> {:error, image_error(settings, kind)}
    end
  end

  def delete(user, id) do
    case Repo.get(Expression, id || "") do
      nil ->
        {:error, :not_found}

      %Expression{user_id: owner_id} = expression ->
        if owner_id == user.id or Waystone.Accounts.manage_channels?(user) do
          Repo.delete!(expression)

          case stored_path(expression.id) do
            {:ok, path} -> File.rm(path)
            :error -> :ok
          end

          :ok
        else
          {:error, :forbidden}
        end
    end
  end

  def read(id) do
    with %Expression{} = expression <- Repo.get(Expression, id || ""),
         {:ok, path} <- stored_path(id),
         true <- File.regular?(path) do
      {:ok, expression, path}
    else
      _ -> :error
    end
  end

  def sticker_attachment(id) do
    case Repo.get(Expression, id || "") do
      %Expression{kind: "sticker", name: name, id: sticker_id} ->
        {:ok, %{"kind" => "sticker", "id" => sticker_id, "name" => name}}

      _ ->
        {:error, "That sticker is no longer available."}
    end
  end

  def public(%Expression{} = expression) do
    %{
      id: expression.id,
      kind: expression.kind,
      name: expression.name,
      content_type: expression.content_type,
      byte_size: expression.byte_size,
      user_id: expression.user_id
    }
  end

  defp normalize_name(name) when is_binary(name) do
    trimmed = name |> String.trim() |> String.downcase()
    if Regex.match?(@name, trimmed), do: {:ok, trimmed}, else: {:error, name_hint()}
  end

  defp normalize_name(_), do: {:error, name_hint()}

  defp name_hint, do: "Use 2–32 letters, numbers, or underscores."

  defp name_error(changeset) do
    if Enum.any?(changeset.errors, fn {field, _} -> field in [:kind, :name] end),
      do: "That name is already used.",
      else: name_hint()
  end

  defp authorize(_user, %{expression_uploads: "off"}),
    do: {:error, "The room is not accepting new emoji or stickers."}

  defp authorize(%{role: "admin"}, %{expression_uploads: "admin"}), do: :ok

  defp authorize(_user, %{expression_uploads: "admin"}),
    do: {:error, "Only an admin can add emoji and stickers."}

  defp authorize(%{role: role}, %{expression_uploads: "moderator"})
       when role in ["admin", "moderator"],
       do: :ok

  defp authorize(_user, %{expression_uploads: "moderator"}),
    do: {:error, "Only a moderator can add emoji and stickers."}

  defp authorize(_user, _settings), do: :ok

  defp within_limit(settings, kind) do
    count = Repo.aggregate(from(e in Expression, where: e.kind == ^kind), :count)
    limit = settings.expression_limit

    if count < limit,
      do: :ok,
      else: {:error, "The room already has #{limit} #{kind}."}
  end

  defp max_bytes(%{sticker_max_bytes: bytes}, "sticker"), do: bytes
  defp max_bytes(%{emoji_max_bytes: bytes}, _), do: bytes

  defp image_error(settings, "sticker") do
    "Stickers are PNG, JPEG, GIF, or WebP images up to #{kb(settings.sticker_max_bytes)}."
  end

  defp image_error(settings, _) do
    "Emoji are PNG, JPEG, GIF, or WebP images up to #{kb(settings.emoji_max_bytes)}."
  end

  defp kb(bytes) do
    n = div(bytes, 1024)
    if n >= 1024, do: "#{div(n, 1024)} MB", else: "#{n} KB"
  end

  defp stored_path(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, Path.join(root(), uuid)}
      :error -> :error
    end
  end

  def root do
    Application.get_env(:waystone, __MODULE__, [])
    |> Keyword.get(:root) ||
      Path.join(Path.dirname(Waystone.Repo.config()[:database]), "expressions")
  end
end
