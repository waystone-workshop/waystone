defmodule Waystone.Accounts.Password do
  @moduledoc false
  @iterations 600_000

  def hash(password) do
    salt = :crypto.strong_rand_bytes(16)

    Enum.join(
      ["pbkdf2_sha256", @iterations, Base.encode64(salt), Base.encode64(derive(password, salt))],
      "$"
    )
  end

  def valid?(password, hash) when is_binary(password) and byte_size(password) <= 512 do
    with ["pbkdf2_sha256", "600000", salt, expected] <- String.split(hash || "", "$"),
         {:ok, salt} <- Base.decode64(salt),
         {:ok, expected} <- Base.decode64(expected) do
      Plug.Crypto.secure_compare(derive(password, salt), expected)
    else
      _ ->
        derive(password, <<0::128>>)
        false
    end
  end

  def valid?(_, _), do: false
  defp derive(password, salt), do: :crypto.pbkdf2_hmac(:sha256, password, salt, @iterations, 32)
end
