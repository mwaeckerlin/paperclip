# Tests

Register of all tests, grouped by kind and sorted by the [FEATURES.md](FEATURES.md) number each test covers. `npm test` runs every suite. The guard `tests/docs-contract.sh` fails when a feature has no test entry here or when any test carries a skip marker.

## End-to-end frontend

`npm run test:e2e` starts the built image in `tests/e2e/docker-compose.yml` on a network without internet access, once below `/paperclip` behind Traefik with ``PathPrefix(`/paperclip`)`` and without StripPrefix (`tests/e2e/proxy`), once at the root, and runs `tests/e2e/browser` with Playwright and Chromium.

- **F1** `tests/e2e/browser/test_base_path.py` › test_assets_load_below_the_base_path — the rebuilt interface mounts, its bundle and stylesheet load, and every file of the page answers 200.
- **F2** `tests/e2e/browser/test_base_path.py` › test_bare_base_path_redirects_to_its_slash_form — `/paperclip` and `/paperclip?next=%2F` answer 308 to the slash form, with the query, from the image, as the proxy redirects nothing.
- **F2** `tests/e2e/browser/test_base_path.py` › test_the_page_names_its_assets_below_the_base_path — the page names its assets and icons below `/paperclip`, the base path and its script, and no placeholder.
- **F2** `tests/e2e/browser/test_base_path.py` › test_nothing_outside_the_base_path_is_routed — the proxy answers 404 outside `/paperclip`, so a request that leaves the path fails.
- **F2** `tests/e2e/browser/test_base_path.py` › test_assets_load_below_the_base_path — bundle and stylesheet load below `/paperclip/assets/`.
- **F2** `tests/e2e/browser/test_base_path.py` › test_deep_link_renders_below_the_base_path — `/paperclip/auth` renders the sign-in page with no request outside the path, and a deep link of the board is the page with its assets below the path.
- **F2** `tests/e2e/browser/test_base_path.py` › test_fetch_and_xhr_of_root_absolute_api_stay_below_the_base_path — `fetch` with a string, a `Request`, a `URL` and an absolute address, and `XMLHttpRequest`, reach `/paperclip/api/health`.
- **F2** `tests/e2e/browser/test_base_path.py` › test_websocket_upgrade_reaches_paperclip_only_below_the_base_path — an upgrade below the path reaches Paperclip, which refuses the live events without a session with its own 403, and the same upgrade outside the path gets the 404 of the proxy.
- **F2** `tests/e2e/browser/test_base_path.py` › test_event_source_stays_below_the_base_path — an `EventSource` of a root-absolute address requests below the path.
- **F2** `tests/e2e/browser/test_base_path.py` › test_redirect_of_paperclip_keeps_the_base_path — the redirect of upstream's static files from `/fonts` to `/fonts/` arrives as `/paperclip/fonts/`.
- **F2** `tests/e2e/browser/test_base_path.py` › test_links_history_and_windows_keep_the_base_path — a link by property and by attribute, an image, `history.pushState`, `history.replaceState` and `window.open` of root-absolute addresses go below the path.
- **F2** `tests/e2e/browser/test_base_path.py` › test_document_navigation_to_a_root_absolute_address_stays_below_the_base_path — `location.href = '/auth?next=%2F'` opens `/paperclip/auth`.
- **F2** `tests/e2e/browser/test_base_path.py` › test_foreign_relative_and_prefixed_urls_stay_unchanged — foreign, protocol-relative, prefixed, relative, data and fragment addresses stay as they are.
- **F2** `tests/e2e/browser/test_base_path.py` › test_service_worker_registers_below_the_base_path — on localhost, a secure context, the interface registers its service worker as `/paperclip/sw.js` with the scope `/paperclip/`.
- **F3** `tests/e2e/browser/test_base_path.py` › test_first_admin_signs_up_and_claims_below_the_base_path — the first user signs up on the sign-in page, claims the instance and reaches the board below the path, and no request of the page, websockets included, leaves `/paperclip`.
- **F3** `tests/e2e/browser/test_base_path.py` › test_sign_in_below_the_base_path — a new browser signs in with that account, the session names it, and no request leaves the path.
- **F3** `tests/e2e/browser/test_base_path.py` › test_document_names_no_url_outside_the_base_path — after the sign-in, no `src`, `href` or `action` of the rendered board names an address outside the path.
- **F3** `tests/e2e/browser/test_base_path.py` › test_websocket_opens_below_the_base_path — with the session of the admin, a websocket of the live events opens below the path.
- **F4** `tests/e2e/browser/test_root.py` › test_the_page_names_its_assets_at_the_root — without a base path the page names `/assets/` and `/favicon…`, no placeholder and no base path script.
- **F4** `tests/e2e/browser/test_root.py` › test_first_admin_signs_up_and_claims_at_the_root — sign-up and claim at the root, assets at `/assets/` answer 200, no request carries `/paperclip`.
- **F4** `tests/e2e/browser/test_root.py` › test_sign_in_at_the_root — sign-in at the root, the session names the account, the board names no placeholder and no `/paperclip`.
- **F4** `tests/e2e/browser/test_root.py` › test_redirect_at_the_root_stays_as_upstream_writes_it — `/fonts` redirects to `/fonts/`.
- **F5** `tests/e2e/browser/test_base_path.py` › test_first_admin_signs_up_and_claims_below_the_base_path — with `PAPERCLIP_PUBLIC_URL=http://proxy:8080/paperclip`, sign-up and claim work.
- **F5** `tests/e2e/browser/test_base_path.py` › test_sign_in_below_the_base_path — with that public address, sign-in works and the session holds.
- **F9** `tests/e2e/browser/test_restart.py` › test_account_signs_in_from_the_volume — `tests/run-e2e.sh` recreates the container on the same volume `/paperclip`, and the account of the first admin signs in again.
- **F12** `tests/e2e/browser/conftest.py` › services_ready — `/api/health` reports `ok` below the path, at the root and through the local forward.

## End-to-end stack

- **F2** `tests/run-e2e.sh` › serves_below_the_base_path — the start reports the base path it serves below.
- **F6** `tests/run-e2e.sh` › served_inside_the_container_at_/api/health, served_inside_the_container_at_/paperclip/api/health — inside the container below the base path, `localhost:3100` answers `/api/health` with `ok` at the root, where the health check and the agents of the container address it, and below the path.
- **F9** `tests/run-e2e.sh` › served_inside_the_container_at_/api/health — the container answers on port 3100.
- **F7** `tests/run-e2e.sh` › paperclip_secret_not_in_environment, paperclip-root_secret_not_in_environment — the secret reaches both containers as a file under `/run/secrets` and stands in neither environment, while sign-in works with it.
- **F12** `tests/run-e2e.sh` › paperclip_becomes_healthy_without_internet, paperclip-root_becomes_healthy_without_internet — both containers reach `healthy` through the image's own health check.

## Image contract

`tests/image-contract.sh` on the built image.

- **F1** `tests/image-contract.sh` › patches_hold_in_the_image — `bin/patch-upstream.mjs verify` passes in the image: the page loads its assets through the placeholder, no URL of the page, the stylesheets or the manifest is root-absolute, the scripts read the base path, both server modules are patched, and no `server/ui-dist` replaces the rebuilt interface.
- **F2** `tests/image-contract.sh` › start_loads_serve_ahead_of_paperclip — tini, upstream's entrypoint, `app/serve.mjs` ahead of the tsx loader and `server/dist/index.js`.
- **F7** `tests/image-contract.sh` › refuses_missing_secret_file, refuses_secret_set_twice — the start stops and names `BETTER_AUTH_SECRET_FILE`.
- **F5** `tests/image-contract.sh` › refuses_public_url_without_base_path — the start stops and names the public address to set.
- **F8** `tests/image-contract.sh` › refuses_base_path_without_slash, refuses_base_path_with_space, refuses_base_path_with_dots — the start stops and names `PAPERCLIP_BASE_PATH`.
- **F9** `tests/image-contract.sh` › declares_volume_paperclip — the image declares `/paperclip` as volume.
- **F10** `tests/image-contract.sh` › runs_as_node, uid_is_not_root — the configured user is `node` and its uid is not 0.
- **F12** `tests/image-contract.sh` › declares_health_check — the health check runs `app/health.mjs`.

## Unit

`npm run test:unit` runs the Node.js test runner on the files beside the code.

- **F1** `bin/patch-upstream.test.mjs` › code upstream changed stops the build and names file and text — a changed anchor and a second patch run stop with file, text and count.
- **F2** `bin/patch-upstream.test.mjs` › the router of the interface takes the base path as basename; the interface build writes the placeholder into the page, a runtime base path into scripts, relative URLs into stylesheets; the modulepreload link of later releases gets the placeholder; the page of the server gets the base path ahead of its URLs and the placeholder filled in; the manifest addresses its icons and its start page relative to itself — on the upstream files of release v2026.1023.0.
- **F2** `bin/patch-upstream.test.mjs` › a build below the base path passes the checks; every URL outside the base path in the built result is a finding that names its file.
- **F2** `app/configuration.test.mjs` › the base path is a path, unset or / is the root; a request below the base path loses the base path, the bare base path goes to its slash form; a root-absolute redirect gets the base path, any other stays; the page names the base path ahead of the bundle, and nothing at the root; the placeholder of the build becomes the base path, and nothing at the root.
- **F2** `app/serve.test.mjs` › below the base path the server sees the path of its own routes; the bare base path redirects to its slash form, with the query; a root-absolute redirect below the base path keeps the base path, a foreign one stays; a websocket upgrade below the base path reaches the server with the path of its routes — on a real HTTP server of node, loaded with `node --import` as the image loads it.
- **F4** `app/serve.test.mjs` › without a base path every request reaches the server as it is.
- **F5** `bin/patch-upstream.test.mjs` › Better Auth gets its base URL through authBaseUrl.
- **F5** `app/configuration.test.mjs` › the public URL ends in the base path; Better Auth gets the origin below a base path, upstream's URL at the root.
- **F6** `app/serve.test.mjs` › below the base path the server sees the path of its own routes — the root stays served next to the base path.
- **F7** `app/configuration.test.mjs` › the secret comes from its file and leaves the file variable out of the environment — a file, an empty file, a missing file, both set, the value alone, an empty file variable.
- **F7** `app/serve.test.mjs` › the Better Auth secret comes from its file, and the file variable is gone.
- **F8** `app/configuration.test.mjs` › a base path that is no path stops the start and names the variable.
- **F8** `app/serve.test.mjs` › a wrong setting stops the start with a message that names it.

## Workflow contract

- **F11** `tests/workflow-contract.sh` of `mwaeckerlin/scratch` — the reusable workflow builds and publishes the images a repository names for `amd64` and `arm64`; this repository calls it from `.github/workflows/docker.yml`.
