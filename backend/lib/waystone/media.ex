defmodule Waystone.Media do
  @moduledoc "Bounded raster-image decoding without changing the original image bytes."

  def decode_image(data, max_bytes)
      when is_binary(data) and is_integer(max_bytes) and max_bytes > 0 and
             byte_size(data) <= 4 * div(max_bytes + 2, 3) do
    with {:ok, bytes} <- Base.decode64(data),
         true <- byte_size(bytes) <= max_bytes,
         {mime, ext} <- image_type(bytes) do
      {:ok, bytes, mime, ext}
    else
      _ -> {:error, :invalid_image}
    end
  end

  def decode_image(_, _), do: {:error, :invalid_image}

  defp image_type(<<137, 80, 78, 71, 13, 10, 26, 10, _::binary>>), do: {"image/png", ".png"}
  defp image_type(<<255, 216, 255, _::binary>>), do: {"image/jpeg", ".jpg"}
  defp image_type(<<"GIF87a", _::binary>>), do: {"image/gif", ".gif"}
  defp image_type(<<"GIF89a", _::binary>>), do: {"image/gif", ".gif"}
  defp image_type(<<"RIFF", _::binary-size(4), "WEBP", _::binary>>), do: {"image/webp", ".webp"}
  defp image_type(_), do: :error
end
