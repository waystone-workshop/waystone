# Accounts, profiles, and roles

Choose **Create an account** in the desktop app. Registration requires a username,
password, and the server's invitation code (optional only in unconfigured local
development). Usernames are unique, case-insensitive, 3–24 ASCII letters, digits,
or underscores. Passwords are 12–128 characters, at most 512 UTF-8 bytes.
Registration always creates a **member**, regardless of extra submitted fields.
Subsequent sign-in uses username/password without the invitation code.

**My profile** edits a display name, bio (up to 280 characters), and one of four
avatar colors. **Members** shows profiles and roles. Clicking a new message's
author opens their profile. Display names can repeat; user IDs identify accounts.
Only the owner can edit their profile. Passwords and password hashes are never
returned by profile endpoints. No email or avatar upload service is required.

## Permissions

Members can read all channels, chat, send attachments, edit shared boards, export,
and call. Moderators additionally create/delete channels. Admins have those
permissions and can change roles in **Members**. Role changes are checked in the
database on each API request, so existing tokens do not preserve old privileges.
The last admin cannot be demoted through the API. All roles currently share all
channels; these are server-wide roles rather than per-channel permission lists.

## Assign the first admin

There is deliberately no automatic first-signup admin. Register your own account,
then promote that exact username from a trusted server console.

For local development, from `backend/`:

```sh
mix run -e 'case Waystone.Accounts.promote_admin("your_username") do {:ok, _} -> IO.puts("Admin assigned"); error -> raise inspect(error) end'
```

On Mars, from `/opt/waystone`, while the new backend is running:

```sh
docker compose exec backend bin/waystone rpc 'case Waystone.Accounts.promote_admin("your_username") do {:ok, _} -> IO.puts("Admin assigned"); error -> raise inspect(error) end'
```

These snippets are shell commands for the host running Elixir, not the desktop
renderer. If Windows shell quoting interferes, use `iex -S mix` and enter
`Waystone.Accounts.promote_admin("your_username")` interactively. Refresh Members
or sign in again to update displayed controls. Never put passwords or the invite
code in checked-in commands. Additional admins can then be appointed in the UI.

## Sessions and rollout

Opaque random tokens expire after seven days; only SHA-256 token hashes are stored
in SQLite. The desktop remembers the current token in the user profile, sealed
with the operating system when that is available, and never stores the password.
Opening the app sends that token to `GET /api/me` before the workspace appears.
A rejected or missing token stays on the sign-in page. Logout deletes
that session and disconnects its sockets. Password change requires the current
password, revokes every session, and disconnects sockets across devices. Socket
channels also check expiry/revocation every minute. Usernames cannot currently
be renamed, and there is no email-based password recovery.

Password hashing uses Erlang's PBKDF2-HMAC-SHA256 with a fresh 16-byte salt and
600,000 iterations, following the [OWASP PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Login, registration, and password-change attempts share a bounded in-memory
20-attempt/minute limit per source IP. Behind the current reverse proxy, clients
may share that source bucket. It resets on backend restart and is not a distributed
rate limiter. Authentication inputs are filtered from Phoenix parameter logs.

The migration preserves old messages and their author labels. They have no user
ID and cannot be claimed just by registering an old nickname. New messages carry
the sender's immutable user ID plus the display name at send time. Renaming a
profile does not rewrite historical transcripts.

Old nickname tokens are intentionally rejected by the new API. Ship the desktop
and backend together through the normal release pipeline. Existing users need
the updated desktop and must register once. The existing group invite code remains
valid for registration. Merely merging this change does not deploy it to Mars.

## Verification

Run `mix precommit` in `backend/`, and `npm test`, `npm run test:e2e`, and
`npm run test:accounts` in `frontend/`. The accounts integration test launches
real Phoenix and Electron against an isolated temporary database and removes it
afterward; it requires Elixir, Node, and a graphical desktop session.

For `npm run test:audio`, supply temporary environment variables
`WAYSTONE_TEST_USERNAME`, `WAYSTONE_TEST_PASSWORD`, `WAYSTONE_TEST_USERNAME_2`,
`WAYSTONE_TEST_PASSWORD_2`, and optionally `WAYSTONE_TEST_SERVER`. Both accounts
must exist, and the first needs moderator/admin permissions for the temporary
channel check. Do not reuse personal credentials in scripts or commit them.
