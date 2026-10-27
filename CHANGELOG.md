# Changelog

- 2026-10-27 **1.0.1**
    - The test of the websocket upgrade reads a chunked answer as well, which Paperclip sends on arm64, so the image is published for both architectures

- 2026-10-27 **1.0.0**
    - Paperclip, the work manager for AI agents, from the upstream image, at the root or below a path of its own such as `/paperclip`
    - Below a path, the page, its assets, every API call, the websockets, the server-sent events and the redirects stay below it, behind a reverse proxy that forwards the path unchanged
    - Sign-up, the claim of the first admin and sign-in work below the path, with a public address that carries the path
    - The session secret comes from a Docker secret file and never stands in the environment of the container
    - A wrong path, a public address with another path or a missing secret file stops the start with a message that names the setting
    - Reports its health to Docker and Swarm once Paperclip is ready
    - Published for `linux/amd64` and `linux/arm64`
