# Paperclip Docker Image

[mwaeckerlin/paperclip] runs [Paperclip], the open source work manager for AI agents, from the upstream image `ghcr.io/paperclipai/paperclip`, at the root of its address or below a path of its own such as `https://swarm-01/paperclip/`.

Upstream serves Paperclip at the root only: its interface requests every page, asset and API call root-absolute, and its documentation names no base path setting. This image builds the same release so that the server itself serves everything below `PAPERCLIP_BASE_PATH`: the page, the assets, every API call, the websockets and server-sent events, and its redirects. The reverse proxy forwards the path unchanged, with no StripPrefix and no rewriting of pages or bundles.

All features are listed in [FEATURES.md](FEATURES.md), all tests in [TESTS.md](TESTS.md).

The image is a production service image and runs directly. It is built on the upstream application image and therefore keeps its Debian base, its shell and its command line tools: the agents Paperclip runs start them.

## Usage

```bash
printf '%s' "$(openssl rand -hex 32)" | docker secret create paperclip_better_auth_secret -
```

A Swarm service or a Compose stack below the path `/paperclip`:

```yaml
services:
  paperclip:
    image: mwaeckerlin/paperclip
    environment:
      PAPERCLIP_BASE_PATH: /paperclip
      PAPERCLIP_PUBLIC_URL: https://swarm-01/paperclip
      BETTER_AUTH_SECRET_FILE: /run/secrets/paperclip_better_auth_secret
    secrets:
      - paperclip_better_auth_secret
    volumes:
      - data:/paperclip
    pids_limit: 2048
    stop_grace_period: 90s
    deploy:
      labels:
        traefik.enable: "true"
        traefik.http.routers.paperclip.rule: PathPrefix(`/paperclip`)
        traefik.http.services.paperclip.loadbalancer.server.port: "3100"
secrets:
  paperclip_better_auth_secret:
    external: true
volumes:
  data:
```

The proxy routes the path and nothing else: no `stripprefix` middleware, no redirect of its own. The image answers the bare path `/paperclip` with a redirect to `/paperclip/`.

On the first visit Paperclip asks for the first admin: create an account on the sign-in page and claim the instance with it. In `public` exposure the claim in the browser is switched off by upstream; the first admin then comes from the invite that `npx paperclipai auth bootstrap-ceo` prints inside the container.

Without `PAPERCLIP_BASE_PATH`, Paperclip serves at the root as upstream does. [docker-compose.yml](docker-compose.yml) starts it that way on `http://localhost:3100`, with the secret from the environment variable `PAPERCLIP_BETTER_AUTH_SECRET`: `npm start`.

## Administration

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PAPERCLIP_BASE_PATH` | *(empty)* | Path below which Paperclip serves, such as `/paperclip`; empty or `/` serves at the root |
| `PAPERCLIP_PUBLIC_URL` | *(empty)* | Address users open, with the base path, such as `https://swarm-01/paperclip`; Paperclip builds the links it hands out and the API address of its agents from it |
| `BETTER_AUTH_SECRET_FILE` | *(empty)* | File with the secret that signs the sessions, a Docker secret such as `/run/secrets/paperclip_better_auth_secret` |
| `BETTER_AUTH_SECRET` | *(empty)* | The same secret as a value, for a deployment without Docker secrets; set one of the two |

Every other setting of Paperclip is an environment variable of upstream ([environment variables]). The upstream image presets `PAPERCLIP_DEPLOYMENT_MODE=authenticated`, `PAPERCLIP_DEPLOYMENT_EXPOSURE=private` and `PAPERCLIP_HOME=/paperclip`. Paperclip accepts requests for the host name of `PAPERCLIP_PUBLIC_URL` and for `localhost`; further host names go into `PAPERCLIP_ALLOWED_HOSTNAMES`, comma-separated.

The server listens on port 3100; another port outside is the port mapping of the deployment.

### Checks at the Start

The start stops with a message that names the variable when:

- `PAPERCLIP_BASE_PATH` is no path of letters, digits and `. _ ~ -` segments with a leading slash, such as `paperclip`, `/a b` or `/x/../y`;
- `PAPERCLIP_PUBLIC_URL` is set and its path differs from `PAPERCLIP_BASE_PATH`; the message names the address to set;
- `BETTER_AUTH_SECRET_FILE` names a file that is missing or empty, or `BETTER_AUTH_SECRET` is set as well.

### Volume

- `/paperclip` holds the embedded PostgreSQL, the uploads, the agent workspaces and the instance configuration. Persist it; it is the whole state of the service.

The container runs as `node` of the upstream image, uid 1000, gid 1000; the volume must be writable for it. A named volume takes the owner of the image's directory.

### Health

The image declares a `HEALTHCHECK`: healthy once `/api/health` reports `ok`, which Paperclip does when its start, its migrations and its recovery are done. The first start creates the database, so the start period is 10 minutes.

### Migrating a Rewriting Stack

A stack that ran upstream's image with a `command` that rewrote `index.html` and the bundles with `sed`, and a proxy with StripPrefix, drops all three: the stack sets `PAPERCLIP_BASE_PATH`, `PAPERCLIP_PUBLIC_URL` with the path and `BETTER_AUTH_SECRET_FILE`, leaves `command` and `entrypoint` to the image, and the proxy forwards the path unchanged. A `command` of the stack replaces the start of the image, and Paperclip then serves at the root only.

### Architectures

The image is built for `linux/amd64` and `linux/arm64`, on the upstream image of the same architecture, which upstream publishes for both.

## Development

```bash
npm run build
npm test
```

`npm test` runs, and fails on any single error:

1. **Docs contract** (`tests/docs-contract.sh`): every feature has a test, no test is skipped.
2. **Unit tests** (`npm run test:unit`, the Node.js test runner): the settings and helpers of `app/configuration.mjs`, the request handling of `app/serve.mjs` on a real HTTP server of node, and the patches of `bin/patch-upstream.mjs` on the files of the upstream release.
3. **Image contract** (`tests/image-contract.sh`): the user, the start, the health check, the volume, the patches checked in the built image, and the start stopping on every wrong setting.
4. **End to end** (`tests/run-e2e.sh`): the image below `/paperclip` behind Traefik with ``PathPrefix(`/paperclip`)`` and without StripPrefix, and the image at the root, on a network without internet access; Chromium signs up, claims the instance, signs in, and every request of the page stays below `/paperclip`, and the account signs in again from a new container on the same volume.

GitHub Actions builds the image and publishes it on Docker Hub on every push to the default branch and when the upstream image changed ([.github/workflows/docker.yml](.github/workflows/docker.yml), the reusable workflow of [mwaeckerlin/scratch]), natively for `linux/amd64` and `linux/arm64`, with the tags `latest`, `<version>`, `<YYYYMMDD>` and `<version>-<YYYYMMDD>`.

## Internals

### Base Path Mechanism

The build patches the release in the upstream image and builds its interface again; `bin/patch-upstream.mjs patch` names every text it replaces and how often upstream carries it, so a changed upstream stops the build with the file and the text, and `bin/patch-upstream.mjs verify` checks the result in the build and in the image test.

- **Interface build** (`ui/vite.config.ts`): Vite's `experimental.renderBuiltUrl` writes the placeholder `/__PAPERCLIP_BASE_PATH__` in front of every URL of `index.html`, gives every URL a script computes the base path at runtime (`globalThis.__paperclipBasePath`), and writes the URLs of the stylesheets relative to them. The web manifest addresses its icons relative to itself.
- **Router** (`ui/src/main.tsx`): `BrowserRouter` gets the base path as `basename`, so every route, link and navigation of the interface lies below it.
- **Page** (`server/dist/ui-branding.js`): upstream already renders `index.html` at every request through `applyUiBranding`, which fills its marked blocks. The patch fills the placeholder with the base path, empty at the root, and writes the base path and `paperclip-base-path.js` into the block of the head.
- **Requests of the bundle** (`app/paperclip-base-path.js`): the bundle requests `/api/…`, `/sw.js` and `/brands/…` root-absolute in many places. The script, loaded before the bundle, puts the base path in front of every root-absolute URL of the own origin in `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, workers, the service worker, `window.open`, `sendBeacon`, the history, the `src`, `href` and `action` of elements, and, with the Navigation API, a document navigation.
- **Server** (`app/serve.mjs`, loaded with `node --import` ahead of Paperclip): Paperclip runs one HTTP server for the page, the API, the events and the websockets. The module takes the base path off every request and websocket upgrade below it before Paperclip's routes see it, puts it in front of every root-absolute `Location` of the answer, and answers the bare path with a redirect to its slash form. Requests outside the base path reach Paperclip unchanged, for the health check and for the agents in the container that address it at the root.
- **Sign-in** (`server/dist/auth/better-auth.js`): Better Auth takes a path in its base URL as the path of its own routes. Below a base path it gets the origin of `PAPERCLIP_PUBLIC_URL`, and its routes stay `/api/auth/…` below the base path, where Paperclip mounts them.

### Limitations

- The service worker of upstream caches the hashed assets for an offline start only when they lie at `/assets/`; below a base path it passes every request to the network.
- Code of the interface that reads `location.pathname` directly sees the base path in front, where upstream compares it with a route of its own, such as the public page `/dot-connect/…`.
- A plugin interface that upstream loads with a dynamic `import()` of a root-absolute URL reaches the root, which the script cannot rebase.

## Licence

The MIT licence in [LICENSE](LICENSE) covers the files of this repository. Paperclip itself is MIT licensed; the command line tools of the upstream image keep their own licences.

[mwaeckerlin/paperclip]: https://hub.docker.com/r/mwaeckerlin/paperclip "get the image from docker hub"
[Paperclip]: https://github.com/paperclipai/paperclip
[environment variables]: https://docs.paperclip.ing/deploy/environment-variables
[mwaeckerlin/scratch]: https://github.com/mwaeckerlin/scratch
