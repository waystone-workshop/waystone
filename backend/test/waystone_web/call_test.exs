defmodule WaystoneWeb.CallTest do
  use WaystoneWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:waystone, :voice)

    Application.put_env(:waystone, :voice,
      url: "ws://127.0.0.1:7880",
      api_key: "testkey",
      api_secret: "test-secret"
    )

    on_exit(fn ->
      if previous,
        do: Application.put_env(:waystone, :voice, previous),
        else: Application.delete_env(:waystone, :voice)
    end)

    {:ok, channel} = Waystone.Chat.create_channel(%{name: "audio-test"})
    %{channel: channel}
  end

  test "call credentials require authentication", %{conn: conn, channel: channel} do
    assert conn |> post("/api/channels/#{channel.id}/call") |> json_response(401)
  end

  test "token is signed, short lived and limited to the channel microphone", %{
    conn: conn,
    channel: channel
  } do
    session = Waystone.AccountsFixtures.token()
    conn = put_req_header(conn, "authorization", "Bearer " <> session)
    response = conn |> post("/api/channels/#{channel.id}/call") |> json_response(200)
    [header, payload, signature] = String.split(response["token"], ".")

    assert :crypto.mac(:hmac, :sha256, "test-secret", header <> "." <> payload) ==
             Base.url_decode64!(signature, padding: false)

    claims = payload |> Base.url_decode64!(padding: false) |> Jason.decode!()
    assert claims["iss"] == "testkey"
    assert claims["name"] == "Ada"
    assert {:ok, _} = Ecto.UUID.cast(claims["sub"])
    assert claims["exp"] - claims["nbf"] == 305

    assert claims["video"] == %{
             "room" => "channel-#{channel.id}",
             "roomJoin" => true,
             "canPublish" => true,
             "canSubscribe" => true,
             "canPublishSources" => ["microphone"],
             "canPublishData" => false
           }
  end

  test "unconfigured voice returns an actionable error", %{conn: conn, channel: channel} do
    Application.delete_env(:waystone, :voice)
    session = Waystone.AccountsFixtures.token()

    assert conn
           |> put_req_header("authorization", "Bearer " <> session)
           |> post("/api/channels/#{channel.id}/call")
           |> json_response(503)
  end
end
