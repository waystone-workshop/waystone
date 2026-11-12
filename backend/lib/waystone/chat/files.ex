defmodule Waystone.Chat.Files do
  @moduledoc """
  Friend-shared files live on disk beside the database. A message stores only
  the name and size, so history and the desktop bridge never carry the bytes.
  """

  import Ecto.Query

  alias Waystone.Chat.SharedFile
  alias Waystone.Repo

  @chunk 1_048_576
  @default_max 256 * 1024 * 1024

  def max_bytes do
    Application.get_env(:waystone, __MODULE__, [])
    |> Keyword.get(:max_bytes, @default_max)
  end

  def root do
    Application.get_env(:waystone, __MODULE__, [])
    |> Keyword.get(:root) ||
      Path.join(Path.dirname(Waystone.Repo.config()[:database]), "files")
  end

  def receive_upload(conn, user, channel_id) do
    with :ok <- check_length(conn),
         {:ok, conn, path, size} <- stream_body(conn) do
      case store(user, channel_id, path, display_name(conn), size) do
        {:ok, file} -> {:ok, conn, file}
        {:error, reason} -> {:error, conn, reason}
      end
    end
  end

  def public(%SharedFile{} = file) do
    %{id: file.id, name: file.name, byte_size: file.byte_size}
  end

  def metadata(%SharedFile{} = file) do
    %{
      "id" => file.id,
      "kind" => "file",
      "name" => file.name,
      "content_type" => "application/octet-stream",
      "byte_size" => file.byte_size
    }
  end

  def attachment(%Waystone.Accounts.User{id: user_id}, channel_id, id)
      when is_integer(channel_id) do
    case Repo.get(SharedFile, id || "") do
      %SharedFile{user_id: ^user_id, channel_id: ^channel_id, message_id: nil} = file ->
        {:ok, metadata(file)}

      _ ->
        {:error, "That file is no longer available."}
    end
  end

  def attachment(_, _, _), do: {:error, "That file is no longer available."}

  def bind(message, attachments, %Waystone.Accounts.User{id: user_id}) do
    Enum.each(attachments, fn
      %{"kind" => "file", "id" => id} ->
        case Repo.update_all(
               from(f in SharedFile,
                 where:
                   f.id == ^id and f.user_id == ^user_id and f.channel_id == ^message.channel_id and
                     is_nil(f.message_id)
               ),
               set: [message_id: message.id]
             ) do
          {1, _} -> :ok
          _ -> Repo.rollback("That file is no longer available.")
        end

      _ ->
        :ok
    end)

    :ok
  end

  def bind(_message, attachments, _author) do
    if Enum.any?(attachments, &(&1["kind"] == "file")),
      do: Repo.rollback("Sign in to share a file."),
      else: :ok
  end

  def discard(%Waystone.Accounts.User{id: user_id}, channel_id, id) do
    with {:ok, path} <- stored_path(id),
         %SharedFile{user_id: ^user_id, channel_id: ^channel_id, message_id: nil} = file <-
           Repo.get(SharedFile, id) do
      Repo.delete!(file)
      File.rm(path)
      :ok
    else
      _ -> {:error, :not_found}
    end
  end

  def paths(channel_id) do
    from(f in SharedFile, where: f.channel_id == ^channel_id, select: f.id)
    |> Repo.all()
    |> Enum.flat_map(fn id ->
      case stored_path(id) do
        {:ok, path} -> [path]
        :error -> []
      end
    end)
  end

  def remove(paths) when is_list(paths), do: Enum.each(paths, &File.rm/1)

  def read(id) do
    with {:ok, path} <- stored_path(id),
         true <- File.regular?(path),
         {:ok, bytes} <- File.read(path) do
      {:ok, bytes}
    else
      _ -> :error
    end
  end

  def stored_path(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, Path.join(root(), uuid)}
      :error -> :error
    end
  end

  def content_disposition(name) when is_binary(name) do
    ascii =
      name
      |> String.replace(~r/[^A-Za-z0-9._ -]/, "_")
      |> String.slice(0, 120)

    ascii = if ascii in ["", ".", ".."], do: "file", else: ascii
    encoded = URI.encode(name, &URI.char_unreserved?/1)
    ~s(attachment; filename="#{ascii}"; filename*=UTF-8''#{encoded})
  end

  defp store(user, channel_id, source, name, size) do
    changeset =
      %SharedFile{channel_id: channel_id, user_id: user.id}
      |> Ecto.Changeset.change(%{name: name, byte_size: size})
      |> Ecto.Changeset.validate_required([:name, :byte_size, :channel_id, :user_id])
      |> Ecto.Changeset.validate_number(:byte_size,
        greater_than: 0,
        less_than_or_equal_to: max_bytes()
      )
      |> Ecto.Changeset.validate_length(:name, min: 1, max: 120)

    case Repo.insert(changeset) do
      {:ok, file} ->
        case stored_path(file.id) do
          {:ok, dest} ->
            case File.rename(source, dest) do
              :ok ->
                {:ok, file}

              {:error, _} ->
                Repo.delete(file)
                File.rm(source)
                {:error, "Could not store that file."}
            end

          :error ->
            Repo.delete(file)
            File.rm(source)
            {:error, "Could not store that file."}
        end

      {:error, _} ->
        File.rm(source)
        {:error, "Could not store that file."}
    end
  end

  defp check_length(conn) do
    case Plug.Conn.get_req_header(conn, "content-length") do
      [value] ->
        case Integer.parse(value) do
          {0, ""} ->
            {:error, conn, "Choose a file that isn't empty."}

          {n, ""} when n > 0 ->
            if n > max_bytes(), do: {:error, conn, too_big()}, else: :ok

          _ ->
            {:error, conn, "Could not read that file."}
        end

      [] ->
        :ok

      _ ->
        {:error, conn, "Could not read that file."}
    end
  end

  defp stream_body(conn) do
    File.mkdir_p!(root())
    path = Path.join(root(), "incoming-" <> Ecto.UUID.generate())

    with {:ok, io} <- File.open(path, [:write, :binary, :exclusive]) do
      try do
        case pull(conn, io, 0) do
          {:ok, conn, 0} ->
            File.rm(path)
            {:error, conn, "Choose a file that isn't empty."}

          {:ok, conn, size} ->
            {:ok, conn, path, size}

          {:error, conn, reason} ->
            File.rm(path)
            {:error, conn, reason}
        end
      after
        File.close(io)
      end
    else
      {:error, _} -> {:error, conn, "Could not store that file."}
    end
  end

  defp pull(conn, io, total) do
    opts = [length: @chunk, read_length: @chunk, read_timeout: 120_000]

    case Plug.Conn.read_body(conn, opts) do
      {:ok, data, conn} ->
        write_chunk(conn, io, total, data, :done)

      {:more, data, conn} ->
        case write_chunk(conn, io, total, data, :more) do
          {:cont, conn, total} -> pull(conn, io, total)
          other -> other
        end

      {:error, _} ->
        {:error, conn, "The upload stopped before it finished."}
    end
  end

  defp write_chunk(conn, io, total, data, mode) do
    total = total + byte_size(data)

    cond do
      total > max_bytes() ->
        {:error, conn, too_big()}

      IO.binwrite(io, data) != :ok ->
        {:error, conn, "Could not store that file."}

      mode == :done ->
        {:ok, conn, total}

      true ->
        {:cont, conn, total}
    end
  end

  defp display_name(conn) do
    case Plug.Conn.get_req_header(conn, "x-file-name") do
      [value] when is_binary(value) and byte_size(value) <= 400 -> clean_name(value)
      _ -> "file"
    end
  end

  defp clean_name(value) do
    name =
      value
      |> URI.decode()
      |> Path.basename()
      |> String.replace(~r/[\x00-\x1F\x7F]/u, "")
      |> String.trim()
      |> String.trim(".")
      |> String.slice(0, 120)

    if name in ["", ".", ".."], do: "file", else: name
  end

  defp too_big do
    mb = div(max_bytes(), 1024 * 1024)
    if mb >= 1, do: "Files can be up to #{mb} MB.", else: "That file is too large."
  end
end
