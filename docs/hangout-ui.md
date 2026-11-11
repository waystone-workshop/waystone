# Hangout desktop redesign

The main screen uses a searchable space switcher, a Conversation/Board switch,
and a collapsible people panel. The people-panel preference is saved on the
device. At narrow widths the panel overlays the conversation instead of squeezing
it. Export, deletion, local Canvases and account actions live in menus/settings.
The initial `general` channel is displayed as **The Common Room** without renaming
its stored identity or rewriting exports. Server connection settings are tucked
away on the sign-in screen.

## Voice has its own lifecycle

Voice rooms are stored separately from text channels. The migration creates
`campfire`; moderators and admins can create/delete additional voice rooms.
Members can join any voice room. The compact voice control shows the room,
participant count, microphone toggle and leave action. Its disclosure contains
participants, deafen, playback recovery, and room switching.

Changing text spaces, opening/closing a board, and deleting a text space do not
leave voice. Joining a different voice room requires confirmation. Leaving voice,
signing out, closing the app, or receiving deletion of the current voice room
releases the microphone. Legacy `/channels/:id/call` remains available for older
clients; new clients use `/voice-rooms/:id/call`. Old channel calls and new voice
rooms are separate LiveKit rooms, so friends should update together.

The microphone is captured in mono at 48 kHz with echo cancellation and automatic
gain. Chromium voice isolation is used when the machine provides it. Otherwise
the desktop runs RNNoise locally and turns the browser suppressor off, so the
two models are never stacked. Speech is published as 64 kbps Opus with redundant
audio frames and without discontinuous transmission, so quiet onsets stay intact.
A noise-model failure leaves the call on the browser suppressor.

## People and profiles

Phoenix Presence tracks authenticated directory sockets by immutable user ID.
Multiple windows/devices count as one online person, and closing one device does
not mark a still-connected user offline. Losing the directory connection displays
presence as unavailable rather than pretending everyone went offline. Voice-room,
mute and speaking metadata are reported by the desktop for display; these signals
do not grant permissions or substitute for voice-token authorization.

Avatars and names in chat, the people panel and voice participants open a profile
popover. A full profile view is available from that popover. Profile editing adds
avatar and banner uploads/removal. PNG, JPEG, GIF and WebP are accepted, with
limits of 10 MB for avatars and 20 MB for banners. GIF animation is preserved;
original files are stored and served without conversion. SVG and remote-image URLs are not
accepted. The server validates encoded size, file signatures and decoded size;
the browser handles raster decoding. Images use a centered crop without a manual
crop/reposition editor.

Profile bytes are stored in a separate SQLite table, included in normal database
backups, and served only to authenticated users. Member-list JSON contains media
versions/content types rather than image bytes. The renderer loads images through
the authenticated desktop bridge into local blob URLs, and releases them on
sign-out. Missing/undecodable images fall back to initials/a plain banner.

## Still outside this pass

- Global message search, unread counters, and persistent read markers.
- Custom activity/status text and automatic away/idle detection.
- Sharing a board as a first-class message attachment with a generated preview.
- Emoji reactions and an emoji picker.
- Avatar/banner crop-position controls.
- Dedicated audio-device selection and volume controls per participant.

These are not represented by inert controls or invented presence/activity data.

## Validation

`mix precommit` covers media authentication/ownership/limits, independent voice
permissions and grants, and multi-device presence. `npm test` retains the offline
Canvas/board and message-export coverage. `npm run test:e2e` covers space search,
panel collapse, narrow layout and the new shell. `npm run test:accounts` exercises
actual uploads, presence, profile cards, embedded boards and roles against an
isolated real Phoenix database.

With local LiveKit running (`voice/start.ps1`), set `WAYSTONE_TEST_AUDIO=1` while
running the accounts integration test to include two synthetic-microphone desktop
clients. Supply the local `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`
environment variables from the development configuration. The audio smoke checks
that text/board navigation and text deletion retain the call, while explicit
leave/rejoin and sign-out still release resources. No personal microphone is used.

This feature branch does not publish a production release. The paired desktop
and backend must be shipped through the usual release pipeline.

Set `WAYSTONE_TEST_LARGE_MEDIA=1` for `npm run test:accounts` to exercise full-size
10 MB avatar and 20 MB banner GIF uploads through the desktop and real HTTP API.
The existing 29 MB JSON parser and 29 MiB nginx limits accommodate a 20 MiB file
after base64 encoding (about 28 MB). Profile upload requests allow three minutes
for slower connections. Chat attachment limits remain 5 MB per image.
