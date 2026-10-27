# Features

Numbered register of every feature of the image; a number is never reused. Every feature is covered by tests listed in [TESTS.md](TESTS.md); the guard `tests/docs-contract.sh` fails when a feature has no test.

- **F1 Paperclip of the upstream release.** The operator runs the Paperclip release of the upstream image `ghcr.io/paperclipai/paperclip` with its interface, its API, its embedded PostgreSQL and its agent tools; a new upstream release builds a new image. Where upstream changed the code the image adapts, the build stops and names the file and the text.
- **F2 Served below a base path.** A user opens Paperclip below a path of a shared address, such as `https://swarm-01/paperclip/`, behind a reverse proxy that forwards that path unchanged, without StripPrefix. The page, every asset, every API call, the websockets, the server-sent events, the service worker and every redirect of Paperclip stay below the path; a link, an image, a window and a navigation the page opens to a root-absolute address of its own server go below the path. The bare path `/paperclip` redirects to `/paperclip/`, with its query. A deep link such as `/paperclip/auth` loads the page and its route. Foreign, relative and already prefixed addresses stay as they are. The path is set with `PAPERCLIP_BASE_PATH`.
- **F3 Sign-up, first admin and sign-in below the base path.** On a new instance below the base path, the first user creates an account on the sign-in page, claims the instance as its first admin and reaches the board; later the same account signs in on the sign-in page, and the session works for every request of the page, the websocket included.
- **F4 At the root without a base path.** Without `PAPERCLIP_BASE_PATH`, or with `/`, Paperclip serves at the root as upstream does: the page names its assets at `/assets/`, redirects stay as upstream writes them, and sign-up, claim and sign-in work there.
- **F5 Public address with the path.** `PAPERCLIP_PUBLIC_URL` carries the base path, such as `https://swarm-01/paperclip`, and Paperclip builds the links it hands out and the API address of its agents from it; the sign-in works with it. A public address whose path differs from the base path stops the start with a message that names the address to set.
- **F6 Root of the container for its own clients.** Below a base path, the container still answers at its root, for its health check and for the agents Paperclip runs in it.
- **F7 Secret from a Docker secret file.** `BETTER_AUTH_SECRET_FILE` names the file whose content becomes the secret that signs the sessions, such as `/run/secrets/paperclip_better_auth_secret`; the secret never stands in the environment of the container. A missing or empty file, or the secret set both ways, stops the start with a message that names the variable.
- **F8 Wrong base path refused.** A base path that is no path of segments of letters, digits and `. _ ~ -` with a leading slash, such as `paperclip`, `/a b` or `/x/../y`, stops the start with a message that names `PAPERCLIP_BASE_PATH`.
- **F9 Data and port.** Paperclip keeps all its state in the volume `/paperclip` and listens on port 3100.
- **F10 Unprivileged.** The service runs as the user `node` of the upstream image, uid 1000, never as root.
- **F11 Published for amd64 and arm64.** Every push and every new upstream image builds the image natively for both architectures and publishes it on Docker Hub, with the reusable workflow of `mwaeckerlin/scratch`.

## Assumptions

- **F12 Health check (A).** The image checks `/api/health` itself and reports healthy once Paperclip reports `ok`, so Docker, Compose and Swarm see when the service is ready; the first start may take up to 10 minutes.
