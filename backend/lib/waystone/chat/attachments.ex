defmodule Waystone.Chat.Attachments do
  @max_bytes 5 * 1024 * 1024

  def validate(items) when is_list(items) and length(items) <= 4 do
    Enum.reduce_while(items, {:ok, []}, fn item, {:ok, acc} ->
      case validate_one(item) do
        {:ok, attachment} -> {:cont, {:ok, acc ++ [attachment]}}
        error -> {:halt, error}
      end
    end)
  end

  def validate(_), do: {:error, "Choose at most four images (5 MB each)."}

  defp validate_one(%{"data" => data} = item)
       when is_binary(data) and byte_size(data) <= 7_000_000 do
    with {:ok, bytes} <- Base.decode64(data),
         true <- byte_size(bytes) <= @max_bytes,
         {mime, ext} <- image_type(bytes),
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

  defp validate_one(_), do: {:error, "Invalid image."}

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

  defp image_type(<<137, 80, 78, 71, 13, 10, 26, 10, _::binary>>), do: {"image/png", ".png"}
  defp image_type(<<255, 216, 255, _::binary>>), do: {"image/jpeg", ".jpg"}
  defp image_type(<<"GIF87a", _::binary>>), do: {"image/gif", ".gif"}
  defp image_type(<<"GIF89a", _::binary>>), do: {"image/gif", ".gif"}
  defp image_type(<<"RIFF", _::binary-size(4), "WEBP", _::binary>>), do: {"image/webp", ".webp"}
  defp image_type(_), do: :error
end
