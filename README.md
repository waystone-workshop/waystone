# Waystone

An installable app for one group of friends, with one Phoenix backend on Mars.
Windows is the primary desktop target; macOS uses the same client.

The landing page lives in the independent
[waystone-website repository](https://github.com/waystone-workshop/waystone-website).
Shared styles and assets live in the versioned
[design-system repository](https://github.com/waystone-workshop/design-system). See
[distribution and Mars CI/CD](docs/distribution.md) for the first rollout and
automatic desktop updates.

## First phase

- Multiple text channels, live messages, and paginated history.
- Pictures (PNG, JPEG, GIF, WebP): up to four per message, 5 MB each.
- A local drawing pad with pen color, brush size, clear, and PNG attachment.
- Per-channel text drafts saved on the device.
- Automatic socket reconnect and history catch-up.
- Coding-agent context exports: preview/copy/save Markdown, or ZIP containing
  `conversation.md` and `attachments/`. Export a whole channel or select the
  first and last messages of an inclusive range. Exports query persisted history,
  not just the 100 messages initially visible. Preserve authors, UTC timestamps,
  message IDs, channel name, pictures, and drawings.

Audio calls are available per text channel with join/leave, mute, deafen, and
participant/speaking indicators. Video calls and screen sharing remain deferred.

## Architecture

Applications are peers:

- `frontend/`: Electron desktop client, tests, and installers.
- `backend/`: Phoenix API, WebSockets, migrations, and tests.
- `voice/`: LiveKit audio forwarding service and local startup configuration.
- `.github/`: shared CI workflows.

Run commands from each application's folder. Add future services as their own
top-level folders. Phoenix web assets remain in `backend/assets/`.
Local retired lobby files are preserved in `backend/legacy/` (ignored by Git),
outside active compilation and tests.

`frontend/` contains a locally bundled Electron UI. It renders messages, manages
local drafts, draws on canvas, and talks to the backend over HTTP and Phoenix
Channels. Audio uses WebRTC through the separate LiveKit service. The renderer has no Node integration; a sandboxed, isolated preload
exposes API requests, local Canvas storage, and export saving. Remote navigation
is denied; media permissions allow only microphone capture from the bundled
desktop page. HTTPS is required except on localhost for development.

Phoenix provides `/api` JSON endpoints and `/socket` authenticated WebSockets.
One SQLite database holds channels, messages and image bytes (base64 in message
attachment metadata), keeping backups and deployment simple for a small group.
There is no clustering or separate broker. Large histories/media volumes will
need attachment storage and streaming exports; current ZIP generation is in memory.

The old LiveView lobby and browser-session join routes have been retired. The
backend provides the API; the website is deployed independently. Chat and calls use the desktop app.
Existing messages migrate into `#general` without changing their IDs or timestamps.

## Backend development

Requires Elixir 1.17+ and compatible Erlang/OTP.

```sh
cd backend
mix setup
mix phx.server
```

Development listens on `127.0.0.1:4000`, with SQLite at `waystone_dev.db`.
No separate database server is needed. Development accepts a display name without
an invitation code. Set `WAYSTONE_INVITE_CODE` to test invitation-only access locally.

## Desktop development

Requires Node.js 24+.

```sh
cd frontend
npm ci
npm start
```

For audio, start the third service in another PowerShell terminal from the repo root:

```powershell
cd voice
.\start.ps1
```

Choose **Join audio** inside a channel. The microphone is requested only when
joining. Switching channels, leaving the call/workspace, or closing the app
releases it. Deafen silences incoming audio separately from microphone mute.
See [voice setup](voice/README.md) for remote deployment and encryption details.
The checked-in voice settings work only on the same machine; other devices need
a reachable LiveKit host and Phoenix's `LIVEKIT_*` environment variables.

Enter `http://localhost:4000`, your display name, and the invitation code if set.
The address and name are remembered. Tokens and invitation codes are not persisted;
you rejoin when opening the app. Text drafts remain on the device after leaving.
Unsent attachments stay in memory and are lost on app close; channel switching
asks before discarding them.

```sh
npm test
npm run package:win  # run on Windows for the NSIS installer
npm run package:mac  # run on macOS for a DMG
npm run package:mac:zip  # alternative macOS app archive
```

GitHub Actions checks the backend and builds both installers. Installers are
currently unsigned; distribution signing/notarization is not configured.
Installed Windows builds download updates in the background and install on normal
exit after a newer stable GitHub Release is published. Version tags build draft
releases with update feeds; publish a reviewed draft to make it available.
See [distribution](docs/distribution.md) for macOS limitations and rollout steps.

## Mars deployment

The repository does not contain Mars credentials or its hostname. Deployment is
not performed by this change. Build a release with `mix assets.deploy` and
`MIX_ENV=prod mix release`; run it behind an HTTPS reverse proxy with WebSocket
upgrade forwarding for `/socket/websocket`.

Required environment variables:

- `DATABASE_PATH`: an absolute SQLite file path on persistent writable storage.
- `SECRET_KEY_BASE`: generate using `mix phx.gen.secret`.
- `WAYSTONE_INVITE_CODE`: shared invitation code for your friends.
- `PHX_HOST`: Mars's public hostname.
- `PHX_SERVER=true`; optional `PORT` (default 4000) and `POOL_SIZE` (default 5).

Release startup runs migrations automatically. Back up SQLite with its backup
API or stop the backend before copying the database and associated WAL files.
Keep one backend instance attached to this database.

## Access model and limits

An invitation code grants access to the entire friend group. Names are display
labels, not unique or verified accounts. Everyone who joins can read all channels,
create channels, send messages and export history. Tokens expire after seven days;
restart/rejoin to obtain a new token. Changing the invitation code stops new joins
but does not revoke issued tokens; rotate `SECRET_KEY_BASE` to revoke all sessions.
No roles, individual bans, rate limits, end-to-end encryption or offline sending
are implemented. Exports label the transcript as untrusted discussion for agents.

## Verification

```sh
cd backend && mix precommit
cd ../frontend && npm test && npm run build && npm run test:e2e
```

With the real local backend and voice service running, `npm run test:audio`
from `frontend/` launches two isolated desktop clients with synthetic microphones
and checks received audio packets, mute, deafen, channel switching, and cleanup.

Backend tests cover invitation checks, authorization, channel isolation, socket
delivery, image validation/download, pagination, and ZIP exports with original
image bytes and inclusive message ranges. Client tests cover range selection,
catch-up deduplication, and the request bridge's URL restrictions.

The renderer integration test runs against an isolated test HTTP/WebSocket backend.
`npm run test:e2e` opens the real Electron app against that same test backend and
closes it afterward; it requires a desktop session that allows GUI processes.

## Local Canvases

Choose **Open local Canvases** on the join screen to work without a backend,
or **Canvases** in the channel sidebar. This phase supports images, drawings and boards; nesting, video, audio and web embeds are deferred.

Each Canvas has a stable UUID, type and revision. Drawings retain editable pen
strokes, with undo/redo and clear. **Save Canvas** writes the object to the app's
local `userData/canvases/` directory using an atomic file replacement. Reopen it
from the library to edit the same object; **Duplicate** creates an independent ID.
Images open in a viewer and can be renamed or duplicated. The library survives
app restarts and is shared by chat identities on this device.

**Export file** saves a portable `.canvas.json` file containing the image or
editable drawing. **Import Canvas file** restores it. Older/conflicting revisions
cannot silently replace newer saved data; imports can be copied to a new ID.
Unsaved drawing changes require saving or discarding before closing the editor.

Chat attachments carry the Canvas ID/revision and a rendered image snapshot.
Saved local edits update local references; newly sent attachments resolve to the
latest local revision. Other devices and chat-context exports currently see the
snapshot sent with the message, with its Canvas ID and revision. Cross-device
Canvas storage, editable document sharing, and synchronization are future work.
Legacy image attachments continue to open as shared image previews.

## Local planning boards

Create a channel, then choose **Open channel board**. Existing boards and portable imports can still be reopened from Local Canvases. A board is a Canvas with its own stable ID
and revision. Sticky notes and plain text belong to the board; image and drawing
placements reference library objects. Placing an object again reuses its source.
Moving, resizing, rotating or removing a placement does not modify that source.
Double-click a placed Canvas (or choose **Edit source Canvas**) to edit it; its
saved changes appear in all local placements. Nested boards are excluded.

- Drag items to move. Shift/Ctrl/Command-click or drag a marquee on empty space
  to select several; dragging one selected item moves the group.
- Select one item to resize with its corner handle, rotate, change note color,
  edit text, or bring it to the front. Double-click a note/text to focus editing.
- Choose **Connect**, then click a source and target. Select the connector line
  or label to name the relationship. Removing a node also removes its connectors.
- Hold Space, middle-drag, or choose **Pan** to move the viewport. Scroll pans;
  Ctrl/Command-scroll zooms under the pointer. Zoom buttons and **Fit** are available.
- Undo/redo coalesces a drag into one action. Ctrl/Command-Z, Shift-Z, D, and
  Delete/Backspace work when focus is on the board, outside text inputs.
- **Save board** persists locally. **Save portable file** exports a `.canvas.json`
  bundle including its referenced resources; import it through the Canvas library.
  Conflicting imports offer an independent copy of the board and all resources.
- **Export plan** previews Markdown, then saves a ZIP with `plan.md`,
  `board.canvas.json`, image files and PNG drawing previews. The editable board
  bundle retains drawing strokes. Notes, item IDs, positions, source revisions,
  and directional labeled relationships are preserved for coding-agent context.

Boards currently support up to 1,000 items and 2,000 connectors. Portable bundles
and context exports have a 128 MB limit. Saved Canvas documents retain the 8 MB
per-object limit. Saving is explicit; closing a dirty board prompts before discard.
Standalone boards work offline. Channel boards use explicit shared saves as described below; live co-editing and nested boards are not implemented.

## Channel-owned boards

Every channel owns exactly one shared board. SQLite creates it in the same
statement that creates the channel, including for callers outside the UI. The
migration backfills existing channels, including `#general`. Ownership and board
identity are immutable, and deleting the board independently is prohibited.

Use **Open channel board** in the channel header. **Save board** uploads its
layout, notes, connectors, and referenced image/drawing documents to the backend.
Other members can open that saved plan; board-update notifications tell them when
to reopen. Shared saves use revision checks: a stale save returns a conflict
instead of overwriting another member's changes. This is explicit snapshot saving,
not live co-editing or automatic merging. Shared payloads are limited to 20 MB.
Local source Canvases may have newer edits than a published board snapshot.

A conflict or disconnected save leaves the editor draft intact. Export its
portable file or context ZIP without publishing, then close/reopen the channel
board to fetch its latest saved version. Portable exports omit channel ownership
so backups and independent copies cannot silently reassign a channel's board.

**Delete channel** asks for confirmation, then deletes the channel, its messages,
and its owned board in one database transaction. Connected clients close the
removed board and clear its local cache; clients that were offline reconcile their
cache when fetching the channel list again. Late saves cannot recreate a deleted
board. Reusable local images/drawings and independent standalone boards remain.
All invited members currently have this capability; individual roles are not yet
implemented. Standalone board creation controls have been removed; channel creation is the entry point for new boards. Existing standalone boards and portable imports remain accessible.

API: `GET /api/channels/:id/board`, `PUT /api/channels/:id/board` (with
`base_revision`, `board`, `canvases`), and `DELETE /api/channels/:id`. Restart the
backend after running `mix ecto.migrate` and restart the desktop app for its new
IPC handlers. Production releases run migrations on startup.
