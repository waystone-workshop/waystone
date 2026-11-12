# Distribution and updates

The deployed method is documented in [the Mars runbook](../deploy/mars/README.md).
The shared `waystone-deploy` skill in the private `agent-context` repository guides
Cursor and Codex through the same process. Jenkins is not used.

The app repository's version tag builds/tests the Windows and macOS desktop,
Linux backend image, pinned website, deployment bundle, and checksum manifest.
The workflow creates a draft GitHub Release. Publishing a stable release promotes
it to both Mars's five-minute polling updater and the desktop update feed.
Website-only pushes are not production deployments: update the website commit
pin in the app release workflow, then release the combined artifacts.

Friends access https://mars.tail1d39aa.ts.net through Tailscale. Download the
Windows installer once from the landing page, then create an account inside the
updated desktop with username/password/invitation code. That first setup is one
progress step for the current user, then Waystone opens. It does not ask for a
folder or an admin account. The landing page's registration section is
informational; accounts are provided by the app/API.
See [accounts and roles](accounts.md) for first-admin assignment and permissions.

Windows clients check for stable updates when they open and every six hours.
There is no Check for updates control. A release found while the app is opening
downloads and installs, then Waystone opens again. A release found during a
session downloads in the background and installs the next time the app opens,
or when it quits. Hiding the window to the tray is not an exit: Quit from the
tray icon installs a downloaded update. A downloaded update does not stop
later checks. If a newer release is published before that install, Waystone
downloads the newer installer and installs only that one. Each release is a full
installer, so the latest one already contains the earlier updates. They do not
force a restart during a call. The update notice can still offer **Restart and install**.
Publish the installer, matching `latest.yml`, and blockmaps together; the updater
cannot use an EXE alone.
Unsigned macOS builds offer manual release downloads until Apple signing and
notarization are configured. Development `npm start` does not self-update.

The account rollout intentionally replaces nickname-only authentication. Release
the matching backend and desktop together. Existing history is preserved, but old
nickname tokens are rejected and friends register once with the existing invite.
The administrator then promotes their registered account through the trusted
server console; registering first never grants admin rights.
