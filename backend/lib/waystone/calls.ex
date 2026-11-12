defmodule Waystone.Calls do
  @moduledoc "Short-lived access to a LiveKit room for microphone, camera, and screen share."

  def join(channel_id, name) do
    grant("channel-#{channel_id}", name, nil)
  end

  def join_voice(room, user), do: grant("voice-#{room.id}", user.display_name, user.id)

  defp grant(room, name, user_id) do
    config = Application.get_env(:waystone, :voice, [])

    with url when is_binary(url) and url != "" <- config[:url],
         key when is_binary(key) and key != "" <- config[:api_key],
         secret when is_binary(secret) and secret != "" <- config[:api_secret] do
      now = System.system_time(:second)

      claims = %{
        iss: key,
        sub: Ecto.UUID.generate(),
        name: name,
        metadata: Jason.encode!(%{user_id: user_id}),
        nbf: now - 5,
        exp: now + 300,
        video: %{
          room: room,
          roomJoin: true,
          canSubscribe: true,
          canPublish: true,
          canPublishSources: ["microphone", "camera", "screen_share"],
          canPublishData: false
        }
      }

      payload = encode(%{alg: "HS256", typ: "JWT"}) <> "." <> encode(claims)

      signature =
        :crypto.mac(:hmac, :sha256, secret, payload) |> Base.url_encode64(padding: false)

      {:ok, %{url: url, token: payload <> "." <> signature}}
    else
      _ -> {:error, :unavailable}
    end
  end

  defp encode(value), do: value |> Jason.encode!() |> Base.url_encode64(padding: false)
end
