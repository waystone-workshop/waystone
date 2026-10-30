defmodule WaystoneWeb.SessionController do
  use WaystoneWeb, :controller

  import Phoenix.Component, only: [to_form: 2]

  alias Waystone.Chat

  def new(conn, _params) do
    render(conn, :new,
      form: to_form(Chat.name_changeset(%{}), as: :session),
      page_title: "Join"
    )
  end

  def create(conn, %{"session" => params}) do
    case Chat.apply_name(params) do
      {:ok, name} ->
        conn
        |> put_session(:display_name, name)
        |> redirect(to: ~p"/")

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> render(:new, form: to_form(changeset, as: :session), page_title: "Join")
    end
  end

  def create(conn, _params) do
    create(conn, %{"session" => %{}})
  end

  def delete(conn, _params) do
    conn
    |> delete_session(:display_name)
    |> redirect(to: ~p"/join")
  end
end
