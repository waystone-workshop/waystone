# Audio service

LiveKit forwards WebRTC audio between members of a channel. Phoenix issues
five-minute room tokens; only microphone publishing is permitted. Each channel
has its own room. No media is recorded or stored by Waystone.

For local Windows development (x64), run `./start.ps1` from this folder. It downloads
LiveKit 1.13.11 from its official release and verifies its SHA-256 checksum.
On other platforms, install the same LiveKit server version and run
`livekit-server --config livekit.dev.yaml`.

Start Phoenix in `backend/` and Electron in `frontend/`, then choose **Join audio**
in a text channel. Participants can mute their microphone, deafen, and leave.
Switching channels or leaving the workspace ends the call and releases the mic.

The checked-in config and credentials are loopback-only development settings.
For a remote deployment, configure LiveKit with TLS, a reachable advertised IP,
and private keys; configure its WebRTC UDP/TCP ports and TURN for restricted
networks. Set `LIVEKIT_URL` (wss://), `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`
on Phoenix. Never ship the API secret to Electron. Consult
https://docs.livekit.io/transport/self-hosting/deployment/ for deployment details.

This uses LiveKit's normal WebRTC transport encryption, not Discord's DAVE
end-to-end encryption. The SFU is trusted. Camera and screen-share publishing
are disallowed by the room token as well as the desktop permission policy.
