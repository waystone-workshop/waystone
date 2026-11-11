defmodule WaystoneWeb.ProfileMediaLimitsTest do
  use WaystoneWeb.ConnCase, async: false
  alias Waystone.Accounts

  test "full-size animated GIF avatars and banners round-trip unchanged; one byte over is rejected",
       %{conn: conn} do
    user = Waystone.AccountsFixtures.user()
    conn = put_req_header(conn, "authorization", "Bearer " <> Accounts.create_session(user))

    for {kind, size} <- [{"avatar", 10 * 1024 * 1024}, {"banner", 20 * 1024 * 1024}] do
      bytes = animated_gif(size)
      encoded = Base.encode64(bytes)
      conn |> put("/api/me/media/#{kind}", %{data: encoded}) |> json_response(200)
      image = conn |> get("/api/users/#{user.id}/media/#{kind}")
      assert get_resp_header(image, "content-type") == ["image/gif"]
      assert response(image, 200) == bytes
      # This also catches decoded-size overflow when the base64 length stays the same.
      over = Base.encode64(animated_gif(size + 1))
      conn |> put("/api/me/media/#{kind}", %{data: over}) |> json_response(422)
      assert Accounts.media(user.id, kind).data == bytes
      assert {:error, _} = Waystone.Chat.Attachments.validate([%{"data" => encoded}])
    end
  end

  defp animated_gif(size) do
    frames =
      Base.decode16!(
        "47494638396101000100800000000000FFFFFF" <>
          "21FF0B4E45545343415045322E300301000000" <>
          "21F904000A0000002C0000000001000100000202440100" <>
          "21F904000A0000002C00000000010001000002024C0100"
      )

    IO.iodata_to_binary([
      frames,
      <<0x21, 0xFE>>,
      comment_blocks(size - byte_size(frames) - 4),
      <<0, 0x3B>>
    ])
  end

  defp comment_blocks(0), do: []

  defp comment_blocks(remaining) do
    count = min(255, remaining - 1)
    count = if remaining - count - 1 == 1, do: count - 1, else: count
    [<<count>>, :binary.copy(<<0>>, count) | comment_blocks(remaining - count - 1)]
  end
end
