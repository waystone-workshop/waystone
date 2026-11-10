# Mars release deployment

## Flow

Commit -> GitHub checks -> version tag -> tested Windows/macOS installers,
Linux backend image, pinned static website, deployment files, SHA-256 manifest
-> draft release -> publish -> Mars deploys -> health checks -> clients update.

GitHub-hosted runners build platform-specific installers. Mars does not need a
public Jenkins endpoint, a GitHub write token, or an untrusted-PR runner. A
systemd timer checks the latest **published stable** release every five minutes.
Publishing is the promotion gate; drafts/prereleases do not roll out.

## First installation (Linux x86-64)

Required: working internet, Tailscale, Docker Engine with Compose v2, curl,
OpenSSL, Python 3, flock and tar. Use Docker's official Debian installation guide:
https://docs.docker.com/engine/install/debian/ .

1. Copy this directory to `/opt/waystone` on Mars. It must be private to the
   deployment administrator, since `.env` will hold production secrets.
2. Run `bash bootstrap.sh` as the account that owns `/opt/waystone`. It generates a fresh application secret,
   invitation code and voice key. Existing `.env` is preserved. Keep an offline
   copy of these credentials and the database backup; never commit them.
3. Publish the completed GitHub release, then run
   `bash install-release.sh v0.4.4`. This downloads only fixed assets from
   the app repository, verifies their SHA-256 checksums, loads the Linux image,
   backs up an existing database, and starts backend, website and voice services.
4. Enable HTTPS privately through Tailscale:

   ```sh
   sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
   sudo tailscale serve --bg --https=8443 http://127.0.0.1:7880
   ```

   Enable tailnet HTTPS if prompted. Do not enable Funnel. Share Mars with
   friends and allow TCP 443/8443/7881 and UDP 7882 through the tailnet policy and
   host firewall. Port 7881 is the media TCP fallback; 7882 carries WebRTC UDP.
5. Verify `https://mars.tail1d39aa.ts.net/` and `/health`, then test a real desktop
   login, text message, board save and two-client audio call. Confirm the hostname
   in `.env`; release installers currently default to that Mars hostname.
6. Install the update timer after the first successful rollout:

   ```sh
   mkdir -p ~/.config/systemd/user
   cp waystone-update.service waystone-update.timer ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now waystone-update.timer
   ```

   Enable linger once with `sudo loginctl enable-linger solrak` so the user timer
   survives logout. The deploy account needs Docker access and ownership of the
   deployment directory; it does not need passwordless sudo.

Friends download `Waystone-Setup.exe` once from the landing page. Its release URL
is stable. Installed Windows clients download stable updates in the background
and install on normal exit. An unsigned macOS build still requires a manual
release download; native automatic updates need Apple signing/notarization.

## Operations and recovery

- `sudo docker compose ps` / `sudo docker compose logs --tail=100 backend`.
- `journalctl --user -u waystone-update.service` for rollout failures.
- The persistent `waystone-data` volume contains the database and pre-deployment
  snapshots under `/data/backups`. Never use `docker compose down -v`.
- Stop the timer with `systemctl --user stop waystone-update.timer` before manual
  recovery. The deployment lock prevents overlapping rollouts.
- A failed rollout stops the backend and retains the database and backup. It
  does not silently restore an old database and discard newer messages.
- For a code-only rollback, first verify schema compatibility, then redeploy the
  previous stable tag. A database restore is a separate deliberate recovery step.
- Add off-host daily backups before treating this as durable production storage.
  Pre-deployment backups on the same machine do not protect against disk loss.
- `website` is a managed symlink to a versioned release directory. Keep the prior
  version until the new site, API and voice checks pass.

The nginx site proxies `/api/`, `/socket/` and `/health` to Phoenix, so the app
and landing share the HTTPS origin. Raw nginx/API/signaling ports bind loopback.
LiveKit advertises Mars's tailnet address rather than a public or Docker IP.
Desktop downloads remain on public GitHub Releases; no group invitation code or
production credential is included in the site, installer, or release artifacts.
