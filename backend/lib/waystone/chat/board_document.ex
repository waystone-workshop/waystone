defmodule Waystone.Chat.BoardDocument do
  @colors ~w(#f4df91 #d5ec9c #b5d9ed #e3c4eb #f0b8ac)

  def validate(%{"board" => board, "canvases" => resources}, expected_id)
      when is_map(board) and is_list(resources) do
    with true <-
           byte_size(Jason.encode!(%{board: board, canvases: resources})) <= 20 * 1024 * 1024,
         true <- board["type"] == "board" and board["version"] == 1 and board["id"] == expected_id,
         true <- text?(board["title"], 120) and String.trim(board["title"]) != "",
         true <- content?(board["content"]),
         true <- length(resources) <= 1000 and Enum.all?(resources, &resource?/1),
         ids <- Enum.map(resources, & &1["id"]),
         true <- length(ids) == length(Enum.uniq(ids)) and expected_id not in ids,
         true <-
           Enum.all?(
             board["content"]["items"],
             &(&1["kind"] != "canvas" or &1["canvasId"] in ids)
           ) do
      {:ok, %{title: board["title"], content: board["content"], resources: resources}}
    else
      _ -> {:error, :invalid_document}
    end
  end

  def validate(_, _), do: {:error, :invalid_document}

  defp content?(%{"items" => items, "connectors" => edges, "view" => view})
       when is_list(items) and is_list(edges) and is_map(view) do
    ids = Enum.map(items, &if(is_map(&1), do: &1["id"]))
    edge_ids = Enum.map(edges, &if(is_map(&1), do: &1["id"]))

    length(items) <= 1000 and length(edges) <= 2000 and length(ids) == length(Enum.uniq(ids)) and
      length(edge_ids) == length(Enum.uniq(edge_ids)) and Enum.all?(items, &item?/1) and
      Enum.all?(edges, fn edge ->
        is_map(edge) and uuid?(edge["id"]) and edge["from"] in ids and
          edge["to"] in ids and edge["from"] != edge["to"] and text?(edge["label"], 200)
      end) and
      number?(view["x"], -1_000_000, 1_000_000) and number?(view["y"], -1_000_000, 1_000_000) and
      number?(view["zoom"], 0.1, 4)
  end

  defp content?(_), do: false

  defp item?(item) when is_map(item) do
    uuid?(item["id"]) and number?(item["x"], -1_000_000, 1_000_000) and
      number?(item["y"], -1_000_000, 1_000_000) and number?(item["width"], 60, 10000) and
      number?(item["height"], 40, 10000) and number?(item["rotation"], -360, 360) and
      is_integer(item["z"]) and item["z"] in 0..100_000 and
      case item["kind"] do
        "canvas" ->
          uuid?(item["canvasId"])

        kind when kind in ["note", "text"] ->
          text?(item["text"], 10000) and item["color"] in @colors

        _ ->
          false
      end
  end

  defp item?(_), do: false

  defp resource?(resource) when is_map(resource) do
    uuid?(resource["id"]) and resource["version"] == 1 and is_integer(resource["revision"]) and
      resource["revision"] > 0 and resource["revision"] <= 9_007_199_254_740_991 and
      not Map.has_key?(resource, "channel") and text?(resource["title"], 120) and
      String.trim(resource["title"]) != "" and
      date?(resource["createdAt"]) and date?(resource["updatedAt"]) and
      case resource["type"] do
        "image" -> image?(resource["content"])
        "drawing" -> drawing?(resource["content"])
        _ -> false
      end
  end

  defp resource?(_), do: false

  defp image?(%{"dataURL" => url}) when is_binary(url) do
    case String.split(url, ",", parts: 2) do
      [header, data]
      when header in [
             "data:image/png;base64",
             "data:image/jpeg;base64",
             "data:image/gif;base64",
             "data:image/webp;base64"
           ] ->
        match?({:ok, [_]}, Waystone.Chat.Attachments.validate([%{"data" => data}]))

      _ ->
        false
    end
  end

  defp image?(_), do: false

  defp drawing?(%{"width" => 1000, "height" => 600, "strokes" => strokes})
       when is_list(strokes) do
    length(strokes) <= 10000 and
      Enum.all?(strokes, fn stroke ->
        is_map(stroke) and is_binary(stroke["color"]) and
          Regex.match?(~r/^#[0-9a-fA-F]{6}$/, stroke["color"]) and
          number?(stroke["size"], 1, 30) and is_list(stroke["points"]) and stroke["points"] != [] and
          Enum.all?(stroke["points"], fn point ->
            case point do
              [x, y] -> number?(x, 0, 1000) and number?(y, 0, 600)
              _ -> false
            end
          end)
      end) and Enum.reduce(strokes, 0, &(length(&1["points"]) + &2)) <= 100_000
  end

  defp drawing?(_), do: false
  defp uuid?(value), do: is_binary(value) and match?({:ok, _}, Ecto.UUID.cast(value))
  defp text?(value, max), do: is_binary(value) and String.length(value) <= max
  defp number?(value, min, max), do: is_number(value) and value >= min and value <= max
  defp date?(value), do: is_binary(value) and match?({:ok, _, _}, DateTime.from_iso8601(value))
end
