defmodule WaystoneWeb.HangoutTest do
  use WaystoneWeb.ConnCase, async: false
  alias Waystone.{Accounts, Repo, VoiceRoom}

  @png "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
  defp auth(conn, user),
    do: put_req_header(conn, "authorization", "Bearer " <> Accounts.create_session(user))

  test "avatars and banners are owned, bounded, authenticated and excluded from directory payloads",
       %{conn: conn} do
    user = Waystone.AccountsFixtures.user()
    other = Waystone.AccountsFixtures.user()
    authenticated = auth(conn, user)
    conn |> put("/api/me/media/avatar", %{data: @png}) |> json_response(401)

    for kind <- ["avatar", "banner"] do
      profile =
        authenticated
        |> put("/api/me/media/#{kind}", %{data: @png, user_id: other.id})
        |> json_response(200)

      assert {:ok, _} = Ecto.UUID.cast(profile[kind <> "_version"])
      assert profile[kind <> "_content_type"] == "image/png"
      refute Map.has_key?(profile, "data")
      assert is_nil(Accounts.media(other.id, kind))
      conn |> get("/api/users/#{user.id}/media/#{kind}") |> response(401)
      image = auth(conn, other) |> get("/api/users/#{user.id}/media/#{kind}")
      assert response(image, 200) == Base.decode64!(@png)
      assert get_resp_header(image, "content-type") == ["image/png"]
      assert get_resp_header(image, "x-content-type-options") == ["nosniff"]
      removed = authenticated |> delete("/api/me/media/#{kind}") |> json_response(200)
      assert is_nil(removed[kind <> "_version"])
      authenticated |> get("/api/users/#{user.id}/media/#{kind}") |> response(404)
    end
  end

  test "media rejects executable types, invalid base64, oversize images and unknown slots", %{
    conn: conn
  } do
    authenticated = auth(conn, Waystone.AccountsFixtures.user())

    for data <- [
          "invalid",
          Base.encode64("<svg onload='alert(1)'/>"),
          String.duplicate("A", 1_398_108)
        ] do
      authenticated |> put("/api/me/media/avatar", %{data: data}) |> json_response(422)
    end

    authenticated |> put("/api/me/media/anything", %{data: @png}) |> json_response(422)
    authenticated |> delete("/api/me/media/anything") |> json_response(422)
    authenticated |> get("/api/users/nope/media/avatar") |> response(404)
  end

  test "replacing profile media changes its version and does not overwrite other profile fields",
       %{conn: conn} do
    authenticated = auth(conn, Waystone.AccountsFixtures.user())
    first = authenticated |> put("/api/me/media/avatar", %{data: @png}) |> json_response(200)
    authenticated |> put("/api/me", %{bio: "Keep this"}) |> json_response(200)
    next = authenticated |> put("/api/me/media/avatar", %{data: @png}) |> json_response(200)
    refute first["avatar_version"] == next["avatar_version"]
    assert next["bio"] == "Keep this"
    assert Repo.aggregate(Waystone.Accounts.ProfileMedia, :count) == 1
  end

  test "voice rooms have their own identity and managers; deleting text cannot delete voice", %{
    conn: conn
  } do
    member = Waystone.AccountsFixtures.user()
    manager = Waystone.AccountsFixtures.user("moderator")
    member_conn = auth(conn, member)
    mod_conn = auth(conn, manager)
    conn |> get("/api/voice-rooms") |> json_response(401)
    member_conn |> post("/api/voice-rooms", %{name: "denied"}) |> json_response(403)
    voice = mod_conn |> post("/api/voice-rooms", %{name: "after-hours"}) |> json_response(201)

    assert Enum.any?(
             (member_conn |> get("/api/voice-rooms") |> json_response(200))["rooms"],
             &(&1["id"] == voice["id"])
           )

    {:ok, text} = Waystone.Chat.create_channel(%{name: "after-hours"})
    mod_conn |> delete("/api/channels/#{text.id}") |> json_response(200)
    assert Repo.get!(VoiceRoom, voice["id"]).name == "after-hours"
    member_conn |> delete("/api/voice-rooms/#{voice["id"]}") |> json_response(403)
    mod_conn |> delete("/api/voice-rooms/#{voice["id"]}") |> json_response(200)
    assert is_nil(Repo.get(VoiceRoom, voice["id"]))
    member_conn |> post("/api/voice-rooms/#{voice["id"]}/call") |> json_response(404)
  end

  test "independent voice grants carry account identity and microphone-only permissions", %{
    conn: conn
  } do
    previous = Application.get_env(:waystone, :voice)

    Application.put_env(:waystone, :voice,
      url: "wss://voice.example.test",
      api_key: "test",
      api_secret: "secret"
    )

    on_exit(fn ->
      if previous,
        do: Application.put_env(:waystone, :voice, previous),
        else: Application.delete_env(:waystone, :voice)
    end)

    user = Waystone.AccountsFixtures.user()
    room = Repo.get_by!(VoiceRoom, name: "campfire")
    conn |> post("/api/voice-rooms/#{room.id}/call") |> json_response(401)
    result = auth(conn, user) |> post("/api/voice-rooms/#{room.id}/call") |> json_response(200)

    claims =
      result["token"]
      |> String.split(".")
      |> Enum.at(1)
      |> Base.url_decode64!(padding: false)
      |> Jason.decode!()

    assert claims["video"]["room"] == "voice-#{room.id}"
    assert claims["video"]["canPublishSources"] == ["microphone"]
    assert Jason.decode!(claims["metadata"]) == %{"user_id" => user.id}
  end
end
