defmodule Waystone.Chat.Attachments do
  @max_bytes 5 * 1024 * 1024

  def validate(items, user \\ nil, channel_id \\ nil)

  def validate(items, user, channel_id) when is_list(items) and length(items) <= 4 do
    Enum.reduce_while(items, {:ok, []}, fn item, {:ok, acc} ->
      case validate_one(item, user, channel_id) do
        {:ok, attachment} -> {:cont, {:ok, acc ++ [attachment]}}
        error -> {:halt, error}
      end
    end)
  end

  def validate(_, _, _), do: {:error, "Choose at most four attachments."}

  defp validate_one(%{"kind" => "file", "file_id" => id}, user, channel_id) do
    Waystone.Chat.Files.attachment(user, channel_id, id)
  end

  defp validate_one(%{"data" => data} = item, _user, _channel_id)
       when is_binary(data) and byte_size(data) <= 7_000_000 do
    with {:ok, _bytes, mime, ext} <- Waystone.Media.decode_image(data, @max_bytes),
         {:ok, reference} <- canvas_reference(item) do
      id = Ecto.UUID.generate()

      {:ok,
       Map.merge(reference, %{
         "id" => id,
         "name" => id <> ext,
         "content_type" => mime,
         "kind" => if(item["kind"] == "drawing", do: "drawing", else: "picture"),
         "data" => data
       })}
    else
      _ -> {:error, "Only PNG, JPEG, GIF and WebP images up to 5 MB are supported."}
    end
  end

  defp validate_one(_, _, _), do: {:error, "Invalid attachment."}

  defp canvas_reference(%{"canvas_id" => id, "canvas_revision" => revision})
       when is_integer(revision) and revision > 0 do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, %{"canvas_id" => uuid, "canvas_revision" => revision}}
      _ -> {:error, :invalid_canvas_reference}
    end
  end

  defp canvas_reference(item) do
    if Map.has_key?(item, "canvas_id") or Map.has_key?(item, "canvas_revision"),
      do: {:error, :invalid_canvas_reference},
      else: {:ok, %{}}
  end
end
