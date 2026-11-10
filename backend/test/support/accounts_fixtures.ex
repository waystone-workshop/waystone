defmodule Waystone.AccountsFixtures do
  alias Waystone.{Accounts, Repo}

  def user(role \\ "member") do
    {:ok, user} =
      Accounts.register(%{
        "username" => "user_#{System.unique_integer([:positive])}",
        "display_name" => "Ada",
        "password" => "test-password-long",
        "invite_code" => Application.get_env(:waystone, :invite_code)
      })

    user |> Ecto.Changeset.change(role: role) |> Repo.update!()
  end

  def token, do: Accounts.create_session(user("moderator"))
end
