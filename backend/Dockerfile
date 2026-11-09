FROM elixir:1.19.5-otp-28-alpine@sha256:bb4b0ee98cafce9e884208747cec16d54715a719939809cf2b5cb817e15d0d30 AS build
RUN apk add --no-cache build-base git
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs mix.lock ./
COPY config config
RUN mix deps.get --only prod && mix deps.compile
COPY lib lib
COPY priv priv
COPY assets assets
RUN mix assets.deploy && mix release

FROM elixir:1.19.5-otp-28-alpine@sha256:bb4b0ee98cafce9e884208747cec16d54715a719939809cf2b5cb817e15d0d30
RUN apk add --no-cache libstdc++ curl sqlite && addgroup -g 10001 waystone && adduser -D -u 10001 -G waystone waystone
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/_build/prod/rel/waystone ./
RUN mkdir -p /data/backups && chown -R 10001:10001 /data
USER 10001:10001
ENV PHX_SERVER=true PORT=4000 DATABASE_PATH=/data/waystone.db
EXPOSE 4000
CMD ["bin/waystone", "start"]
