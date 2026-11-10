defmodule Waystone.Accounts.AuthLimiter do
  @moduledoc "Bounded, per-IP authentication attempt limiter."
  use GenServer

  def start_link(opts),
    do: GenServer.start_link(__MODULE__, %{}, name: Keyword.get(opts, :name, __MODULE__))

  def allow?(key, server \\ __MODULE__), do: GenServer.call(server, {:allow, key})
  @impl true
  def init(state), do: {:ok, state}
  @impl true
  def handle_call({:allow, key}, _from, state) do
    now = System.monotonic_time(:second)
    state = Map.reject(state, fn {_, {_, until}} -> until <= now end)
    {count, until} = Map.get(state, key, {0, now + 60})
    allowed = count < 20 and (Map.has_key?(state, key) or map_size(state) < 10_000)
    state = if allowed, do: Map.put(state, key, {count + 1, until}), else: state
    {:reply, allowed, state}
  end
end
