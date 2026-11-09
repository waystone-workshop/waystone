defmodule WaystoneWeb.ApiController do
  use WaystoneWeb, :controller
  alias Waystone.{Chat, Repo}

  plug :authenticate when action not in [:session]

  def session(conn, params) do
    expected = Application.get_env(:waystone, :invite_code)
    supplied = params["invite_code"] || ""

    allowed =
      is_nil(expected) or (is_binary(supplied) and Plug.Crypto.secure_compare(expected, supplied))

    with true <- allowed, {:ok, name} <- Chat.apply_name(%{"display_name" => params["name"]}) do
      token = Phoenix.Token.sign(WaystoneWeb.Endpoint, "desktop", name)
      json(conn, %{token: token, name: name})
    else
      _ -> conn |> put_status(401) |> json(%{error: "Check your name and invitation code."})
    end
  end

  def channels(conn, _params),
    do: json(conn, %{channels: Enum.map(Chat.list_channels(), &Chat.channel_json/1)})

  def join_call(conn, %{"id" => id}) do
    channel = Chat.get_channel!(id)

    case Waystone.Calls.join(channel.id, conn.assigns.author) do
      {:ok, credentials} ->
        json(conn, credentials)

      {:error, :unavailable} ->
        conn
        |> put_status(503)
        |> json(%{error: "Audio calls are not configured on this server."})
    end
  end

  def create_channel(conn, params) do
    case Chat.create_channel(params) do
      {:ok, channel} ->
        conn |> put_status(201) |> json(Chat.channel_json(channel))

      {:error, _} ->
        conn
        |> put_status(422)
        |> json(%{
          error: "Use a unique name: lowercase letters, numbers and hyphens, up to 40 characters."
        })
    end
  end

  def channel_board(conn, %{"id" => id}), do: json(conn, Chat.board_json(Chat.get_board!(id)))

  def save_channel_board(conn, %{"id" => id} = params) do
    case Chat.save_board(id, params) do
      {:ok, board} ->
        json(conn, Chat.board_json(board))

      {:error, :conflict} ->
        conn
        |> put_status(409)
        |> json(%{
          error:
            "This board changed on another client. Export your local plan before reopening the channel board."
        })

      {:error, _} ->
        conn
        |> put_status(422)
        |> json(%{error: "Invalid board or missing Canvas resources (20 MB maximum)."})
    end
  end

  def delete_channel(conn, %{"id" => id}) do
    {:ok, _} = Chat.delete_channel(id)
    json(conn, %{deleted: true})
  end

  def messages(conn, %{"id" => id} = params) do
    channel = Chat.get_channel!(id)

    before_id =
      case Integer.parse(params["before"] || "") do
        {n, ""} when n > 0 -> n
        _ -> nil
      end

    json(conn, %{
      messages: Enum.map(Chat.recent_messages(channel.id, before_id), &Chat.message_json/1)
    })
  end

  def send_message(conn, %{"id" => id} = params) do
    channel = Chat.get_channel!(id)

    case Chat.send_message(channel.id, conn.assigns.author, params) do
      {:ok, message} ->
        conn |> put_status(201) |> json(Chat.message_json(message))

      {:error, error} ->
        reason =
          if is_binary(error),
            do: error,
            else: "Write a message (up to 2,000 characters) or attach an image."

        conn |> put_status(422) |> json(%{error: reason})
    end
  end

  def attachment(conn, %{"message_id" => message_id, "attachment_id" => attachment_id}) do
    message = Repo.get!(Chat.Message, message_id)

    case Enum.find(message.attachments, &(&1["id"] == attachment_id)) do
      nil ->
        send_resp(conn, 404, "Not found")

      a ->
        conn
        |> put_resp_header("content-type", a["content_type"])
        |> put_resp_header("x-content-type-options", "nosniff")
        |> send_resp(200, Base.decode64!(a["data"]))
    end
  end

  def export(conn, %{"id" => id} = params) do
    {channel, messages} = Chat.Export.selection(id, params, params["format"] != "zip")

    if params["format"] == "zip" do
      {:ok, {_, bytes}} = Chat.Export.bundle(channel, messages)

      send_download(conn, {:binary, bytes},
        filename: channel.name <> ".zip",
        content_type: "application/zip"
      )
    else
      json(conn, %{
        markdown: Chat.Export.markdown(channel, messages),
        count: length(messages),
        through:
          case List.last(messages) do
            nil -> 0
            message -> message.id
          end
      })
    end
  rescue
    ArgumentError ->
      conn
      |> put_status(422)
      |> json(%{error: "Choose valid positive message IDs for the export range."})
  end

  defp authenticate(conn, _) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, name} <-
           Phoenix.Token.verify(WaystoneWeb.Endpoint, "desktop", token, max_age: 604_800) do
      assign(conn, :author, name)
    else
      _ -> conn |> put_status(401) |> json(%{error: "Please join again."}) |> halt()
    end
  end
end
