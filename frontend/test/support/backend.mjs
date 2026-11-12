import { createServer } from "node:http";
import { WebSocketServer } from "ws";
export async function startBackend() {
  const channels = [
    {
      id: 1,
      name: "general",
      board_id: "11111111-1111-4111-8111-111111111111",
    },
  ];
  const messages = [
    {
      id: 1,
      channel_id: 1,
      author: "Grace",
      body: "Let’s plan the next phase.",
      attachments: [],
      inserted_at: new Date().toISOString(),
    },
  ];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const makeBoard = (channel) => ({
    format: "waystone-board",
    version: 1,
    board: {
      version: 1,
      id: channel.board_id,
      revision: 1,
      type: "board",
      title: "#" + channel.name + " board",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: { items: [], connectors: [], view: { x: 60, y: 60, zoom: 1 } },
    },
    canvases: [],
  });
  const boards = new Map(
    channels.map((channel) => [channel.id, makeBoard(channel)]),
  );
  const expressions = { emoji: [], stickers: [] };
  let serverPolicy = {
    expression_uploads: "member",
    emoji_max_bytes: 262144,
    sticker_max_bytes: 524288,
    expression_limit: 200,
  };
  const requests = [];
  let user = { id: 1, username: "ada", display_name: "Ada", bio: "", avatar_color: "pine", role: "admin", inserted_at: "2026-11-01T12:00:00Z" };
  let websockets;
  const http = createServer(async (req, res) => {
    requests.push(req.url);
    let body = "";
    for await (const chunk of req) body += chunk;
    const params = body ? JSON.parse(body) : {};
    const url = new URL(req.url, "http://localhost");
    let data;
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/session")
      data = req.method === "DELETE" ? { signed_out: true } : { token: "test-token", name: user.display_name, user };
    else if (url.pathname === "/api/register") {
      user = { ...user, username: params.username.toLowerCase(), display_name: params.display_name, role: "member" };
      res.statusCode = 201;
      data = { token: "test-token", name: user.display_name, user };
    }
    else if (req.headers.authorization !== "Bearer test-token") {
      res.statusCode = 401;
      data = { error: "Unauthorized" };
    } else if (url.pathname === "/api/voice-rooms") {
      data = { rooms: [{ id: 1, name: "campfire" }] };
    } else if (url.pathname === "/api/me") {
      if (req.method === "PUT") user = { ...user, display_name: params.display_name, bio: params.bio, avatar_color: params.avatar_color };
      data = user;
    } else if (url.pathname === "/api/users") {
      data = { users: [user, { ...user, id: 2, username: "grace", display_name: "Grace", role: "member" }] };
    } else if (/^\/api\/users\/\d+$/.test(url.pathname)) {
      data = user;
    } else if (url.pathname === "/api/me/password") {
      data = { signed_out: true };
    } else if (url.pathname === "/api/channels" && req.method === "POST") {
      data = {
        id: channels.length + 1,
        name: params.name,
        board_id: "22222222-2222-4222-8222-222222222222",
      };
      channels.push(data);
      boards.set(data.id, makeBoard(data));
      for (const ws of websockets.clients)
        ws.send(
          JSON.stringify([null, null, "directory", "channel_created", data]),
        );
    } else if (
      /^\/api\/channels\/\d+$/.test(url.pathname) &&
      req.method === "DELETE"
    ) {
      const id = Number(url.pathname.split("/")[3]),
        channel = channels.find((c) => c.id === id);
      if (!channel) {
        res.statusCode = 404;
        data = { error: "Deleted" };
      } else {
        channels.splice(channels.indexOf(channel), 1);
        boards.delete(id);
        for (let i = messages.length - 1; i >= 0; i--)
          if (messages[i].channel_id === id) messages.splice(i, 1);
        for (const ws of websockets.clients)
          ws.send(
            JSON.stringify([
              null,
              null,
              "directory",
              "channel_deleted",
              { id, board_id: channel.board_id },
            ]),
          );
        data = { deleted: true };
      }
    } else if (url.pathname.endsWith("/board")) {
      const id = Number(url.pathname.split("/")[3]),
        existing = boards.get(id);
      if (!existing) {
        res.statusCode = 404;
        data = { error: "Deleted" };
      } else if (req.method === "PUT") {
        if (params.base_revision !== existing.board.revision) {
          res.statusCode = 409;
          data = { error: "Board changed" };
        } else {
          data = {
            format: "waystone-board",
            version: 1,
            board: { ...params.board, revision: existing.board.revision + 1 },
            canvases: params.canvases,
          };
          boards.set(id, data);
        }
      } else data = existing;
    } else if (url.pathname === "/api/channels") data = { channels };
    else if (
      url.pathname.endsWith("/export") &&
      url.searchParams.get("format") === "zip"
    ) {
      // A minimal ZIP fixture; real transcript/image ZIP contents are verified by ExUnit.
      res.setHeader("Content-Type", "application/zip");
      res.end(Buffer.from([80, 75, 5, 6, ...Array(18).fill(0)]));
      return;
    } else if (url.pathname.endsWith("/export"))
      data = {
        markdown: "# Waystone / general\n\nGrace: Let’s plan the next phase.\n",
        count: messages.length,
        through: messages.at(-1)?.id || 0,
      };
    else if (url.pathname.includes("/attachments/")) {
      res.setHeader("Content-Type", "image/png");
      res.end(png);
      return;
    } else if (url.pathname === "/api/server") {
      if (req.method === "PUT") serverPolicy = { ...serverPolicy, ...params };
      data = serverPolicy;
    } else if (url.pathname === "/api/expressions" && req.method === "GET")
      data = expressions;
    else if (url.pathname === "/api/expressions" && req.method === "POST") {
      const created = {
        id: `expr-${expressions.emoji.length + expressions.stickers.length + 1}`,
        kind: params.kind === "sticker" ? "sticker" : "emoji",
        name: String(params.name || "emoji").toLowerCase(),
        content_type: "image/png",
        byte_size: png.length,
        user_id: user.id,
      };
      expressions[created.kind === "sticker" ? "stickers" : "emoji"].push(created);
      data = created;
    } else if (url.pathname.startsWith("/api/expressions/")) {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      if (req.method === "DELETE") {
        expressions.emoji = expressions.emoji.filter((item) => item.id !== id);
        expressions.stickers = expressions.stickers.filter((item) => item.id !== id);
        data = { ok: true };
      } else {
        res.setHeader("Content-Type", "image/png");
        res.end(png);
        return;
      }
    } else if (/^\/api\/messages\/\d+$/.test(url.pathname) && req.method === "PUT") {
      const message = messages.find((item) => item.id === Number(url.pathname.split("/")[3]));
      message.body = params.body;
      message.edited_at = new Date().toISOString();
      data = message;
    } else if (/^\/api\/messages\/\d+$/.test(url.pathname) && req.method === "DELETE") {
      const id = Number(url.pathname.split("/")[3]);
      const index = messages.findIndex((item) => item.id === id);
      if (index >= 0) messages.splice(index, 1);
      data = { ok: true };
    } else if (req.method === "POST") {
      const target = messages.find((item) => item.id === params.reply_to);
      data = {
        id: messages.length + 1,
        channel_id: Number(url.pathname.split("/")[3]),
        author: "Ada",
        user_id: user.id,
        body: params.body,
        reply: target
          ? { id: target.id, author: target.author, user_id: target.user_id || null, body: target.body, attachment: null }
          : null,
        edited_at: null,
        attachments: (params.attachments || []).map((a, i) =>
          a.kind === "file"
            ? {
                id: a.file_id,
                name: "notes.txt",
                kind: "file",
                content_type: "application/octet-stream",
                byte_size: 1280,
              }
            : a.kind === "sticker"
              ? { id: a.expression_id, name: "sticker", kind: "sticker" }
            : {
                id: `image-${messages.length}-${i}`,
                name: "drawing.png",
                kind: a.kind,
                content_type: "image/png",
                canvas_id: a.canvas_id,
                canvas_revision: a.canvas_revision,
              },
        ),
        inserted_at: new Date().toISOString(),
      };
      messages.push(data);
      for (const ws of websockets.clients)
        ws.send(
          JSON.stringify([
            null,
            null,
            `chat:${data.channel_id}`,
            "message",
            data,
          ]),
        );
    } else
      data = {
        messages: messages.filter(
          (m) => m.channel_id === Number(url.pathname.split("/")[3]),
        ),
      };
    res.end(JSON.stringify(data));
  });
  websockets = new WebSocketServer({ server: http });
  websockets.on("connection", (ws) =>
    ws.on("message", (raw) => {
      const [joinRef, ref, topic, event] = JSON.parse(raw);
      if (event === "phx_join" || event === "heartbeat")
        ws.send(
          JSON.stringify([
            joinRef,
            ref,
            topic,
            "phx_reply",
            { status: "ok", response: {} },
          ]),
        );
      if (event === "phx_join" && topic === "directory") ws.send(JSON.stringify([null, null, "directory", "presence_state", {
        1: { metas: [{ phx_ref: "mock-one", voice_room_id: null }] },
        2: { metas: [{ phx_ref: "mock-two", voice_room_id: null }] },
      }]));
    }),
  );
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));

  return {
    origin: `http://127.0.0.1:${http.address().port}`,
    png,
    requests,
    close: async () => {
      for (const ws of websockets.clients) ws.terminate();
      websockets.close();
      await new Promise((resolve) => http.close(resolve));
    },
  };
}
