defmodule WaystoneWeb.ChatLive do
  use WaystoneWeb, :live_view

  alias Waystone.Chat

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Phoenix.PubSub.subscribe(Waystone.PubSub, Chat.topic())
    end

    {:ok,
     socket
     |> assign(:page_title, "Lobby")
     |> assign(:body, "")
     |> assign(:body_errors, [])
     |> stream(:messages, Chat.list_messages())}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} display_name={@display_name}>
      <div id="chat" class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4">
        <div
          id="messages"
          phx-update="stream"
          phx-hook="MessageList"
          class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4"
        >
          <div
            id="messages-empty"
            class="hidden py-16 text-center text-sm text-base-content/60 only:block"
          >
            No messages yet. Say hello.
          </div>

          <article
            :for={{id, message} <- @streams.messages}
            id={id}
            class={[
              "flex max-w-[85%] flex-col gap-1",
              message.author == @display_name && "self-end items-end"
            ]}
          >
            <div class="flex items-baseline gap-2 text-xs text-base-content/60">
              <span class="font-medium text-base-content">{message.author}</span>
              <time datetime={DateTime.to_iso8601(message.inserted_at)}>
                {Calendar.strftime(message.inserted_at, "%H:%M")}
              </time>
            </div>

            <p class={[
              "rounded-2xl px-3 py-2 text-sm leading-relaxed",
              message.author == @display_name && "bg-primary text-primary-content",
              message.author != @display_name && "bg-base-200"
            ]}>
              {message.body}
            </p>
          </article>
        </div>

        <.form
          for={%{}}
          id="composer"
          phx-hook="Composer"
          phx-submit="send"
          class="flex items-end gap-2 border-t border-base-300 py-3"
        >
          <div class="min-w-0 flex-1">
            <.input
              type="text"
              name="message[body]"
              id="message-body"
              value={@body}
              errors={@body_errors}
              label="Message"
              autocomplete="off"
              placeholder="Write a message"
              maxlength="2000"
              required
            />
          </div>

          <.button variant="primary">
            Send <.icon name="hero-paper-airplane" class="size-4" />
          </.button>
        </.form>
      </div>
    </Layouts.app>
    """
  end

  @impl true
  def handle_event("send", %{"message" => params}, socket) do
    body = Map.get(params, "body") || ""

    case Chat.create_message(socket.assigns.display_name, %{"body" => body}) do
      {:ok, message} ->
        {:noreply,
         socket
         |> stream_insert(:messages, message, at: -1)
         |> assign(:body, "")
         |> assign(:body_errors, [])
         |> push_event("clear-composer", %{})}

      {:error, changeset} ->
        {:noreply,
         socket
         |> assign(:body, String.trim(body))
         |> assign(:body_errors, translate_errors(changeset.errors, :body))}
    end
  end

  @impl true
  def handle_info({:new_message, message}, socket) do
    {:noreply, stream_insert(socket, :messages, message, at: -1)}
  end
end
