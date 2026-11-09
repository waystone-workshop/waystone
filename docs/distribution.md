# First distribution

Use the app repo (`waystone`), the static landing repo (`waystone-website`) and
the shared visual library (`design-system`) under `waystone-workshop`.
Phoenix serves only the API; the Electron installer is an ordinary download.
GitHub Releases in `waystone` hosts installers and updater
metadata. Mars can build/deploy Phoenix through Jenkins later; installers should
continue to build on GitHub's Windows/macOS runners.

## Ship the simple version

1. Finish restoring Mars's internet connection, then configure a trusted SSH key
   for `solrak`. Neither remote deployment nor Jenkins installation has been done.
2. Run the backend on Mars with the production secrets documented in README.
   Keep SQLite on persistent storage; releases already run migrations on startup.
3. Configure Tailscale HTTPS on Mars: `sudo tailscale serve --bg --https=443 4000`.
   The API uses `https://mars.tail1d39aa.ts.net`. Confirm that hostname
   with `tailscale status` on Mars before distributing it. Share Mars with friends
   through Tailscale; they need Tailscale installed and connected to open the site.
4. Build/publish the first installer with the app's tagged-release workflow.
   In `waystone-website`, set `WINDOWS_DOWNLOAD_URL` to the HTTPS release asset
   URL and run `npm ci && npm run build`. Serve `dist/` from a static web server
   on Mars (for example nginx), independently from Phoenix. Configure a second
   Tailscale Serve HTTPS port for that web server. Without a download URL, the
   site labels the installer "coming soon" instead of showing a broken link.
5. Share the landing URL and the invitation code separately. Registration is a
   placeholder; the app still uses display names and the group invitation code.
6. For audio, deploy LiveKit separately, use the Tailscale IP as its advertised
   media address, and proxy signaling over HTTPS/WSS. See `voice/README.md`.
   Allow friends to reach voice signaling and media ports through the tailnet.
   Chat/download access alone does not prove that audio networking works.

The website can become public later without exposing the API because its static
output is separate. Keep Phoenix private to the tailnet.

## Automatic desktop updates

The installed Windows app checks GitHub Releases at startup and every six hours,
downloads newer stable versions in the background, and installs on normal exit.
It does not force a restart during a call. A user can also choose "Restart and
install". No second website download is needed. Development `npm start` builds
do not update themselves. Local drafts and saved Canvases remain in userData.

To publish a new version:

1. Bump `frontend/package.json` and its lockfile with `npm version patch
   --no-git-tag-version` in `frontend/`.
2. Commit the changes and push a matching tag such as `v0.4.2`.
3. The release workflow tests the backend and clients, builds Windows and macOS
   packages, and creates a **draft** GitHub Release with the installers, ZIPs,
   blockmaps and `latest*.yml` update feeds. Publish that draft after reviewing it.
4. Keep the release stable (not prerelease). Existing installed Windows clients
   discover it automatically. Keep old release assets available for downloads.
5. Build the website with the stable GitHub asset URL if it is not already set.
   Stable installer filenames let later releases reuse the same download URL.

Do not upload only the EXE: the updater needs `latest.yml` and its matching
artifacts. The public repository's release feed requires no credentials in the
client. Never embed a GitHub token or signing key in the app.

Windows builds are currently unsigned; HTTPS and updater checksums protect the
download, but publisher signing/SmartScreen trust is not configured. macOS updates
offer a release download link until Apple signing/notarization is configured;
the ZIP target is already included for that future automatic-update path.

## Simple Mars CI/CD plan

Start with GitHub Actions checks and manual deployment. Jenkins is optional,
not required for distributing the first version. If you choose Jenkins:

- Install Jenkins LTS on Mars, reachable only through Tailscale. Use a separate
  service account and a persistent Jenkins home; never expose its port publicly.
- Create one pipeline for this repo's protected `main` branch, with SCM polling
  rather than a public webhook. Do not execute arbitrary fork PR code on Mars.
- Validate `mix precommit`, frontend `npm ci && npm test`, and desktop smoke tests
  on their suitable runners. Build the Phoenix production release on Linux.
- Before deployment, stop the backend and create a SQLite backup including any
  WAL state, or use SQLite's backup API. Preserve the current release directory
  and downloads. Restarting briefly disconnects clients.
- Deploy each backend build to `/opt/waystone/releases/<commit>/`, switch a
  `current` symlink, restart a systemd service, then check HTTPS landing, session
  API, channel messaging and an audio call. Keep secrets outside the repository.
- If a health check fails, stop rollout. Roll back code only when the database
  schema is compatible. Restoring an older database loses subsequent writes;
  require an explicit recovery decision rather than silently replacing it.
- Keep daily database backups off Mars, retain build logs, and notify on failures.
  A successful build isn't a successful deploy: verify the running service.

For the first rollout the remaining prerequisites are Mars connectivity, SSH key
access, a production service with persistent storage, Tailscale HTTPS/sharing,
and the first published installer release. These are not provisioned by the
local code changes.

References: https://www.electron.build/auto-update.html,
https://tailscale.com/docs/reference/tailscale-cli/serve,
https://www.jenkins.io/doc/book/pipeline/.
