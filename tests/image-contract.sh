#!/usr/bin/env bash
# Image contract of mwaeckerlin/paperclip, on the built image:
#   - it runs as the unprivileged user node, never as root;
#   - the patches of bin/patch-upstream.mjs hold in the image (verify);
#   - the start is wired: tini, upstream's entrypoint, app/serve.mjs ahead of
#     Paperclip, and the health check;
#   - a wrong setting stops the start with a message that names it.
#
# `--pull=never` keeps docker from pulling a published image when the local
# build is missing; that would test the wrong artefact.
#
# Usage: tests/image-contract.sh IMAGE

set -uo pipefail

IMAGE="${1:?usage: tests/image-contract.sh IMAGE}"
PASS=0
FAIL=0
declare -a FAILED_NAMES

_pass() { PASS=$((PASS + 1)); echo "  PASS  $1"; }
_fail() { FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); echo "  FAIL  $1: $2"; }

echo "==> Image contract: ${IMAGE}"

if ! docker image inspect "${IMAGE}" > /dev/null 2>&1; then
    _fail "image_exists" "image not built — run 'npm run build' first"
    exit 1
fi
_pass "image_exists"

USER_NAME=$(docker image inspect --format '{{.Config.User}}' "${IMAGE}")
if [[ "${USER_NAME}" == "node" ]]; then
    _pass "runs_as_node"
else
    _fail "runs_as_node" "Config.User is '${USER_NAME}'"
fi

UID_GID=$(docker run --rm --pull=never --entrypoint id "${IMAGE}" -u 2>&1)
if [[ "${UID_GID}" != "0" && -n "${UID_GID}" ]]; then
    _pass "uid_is_not_root"
else
    _fail "uid_is_not_root" "id -u answers '${UID_GID}'"
fi

if OUTPUT=$(docker run --rm --pull=never --entrypoint node "${IMAGE}" /opt/paperclip-base-path/patch-upstream.mjs verify /app 2>&1); then
    _pass "patches_hold_in_the_image"
else
    _fail "patches_hold_in_the_image" "${OUTPUT}"
fi

ENTRYPOINT=$(docker image inspect --format '{{json .Config.Entrypoint}}' "${IMAGE}")
CMD=$(docker image inspect --format '{{json .Config.Cmd}}' "${IMAGE}")
if [[ "${ENTRYPOINT}" == '["/usr/bin/tini","--","docker-entrypoint.sh"]' \
   && "${CMD}" == '["node","--import","/opt/paperclip-base-path/serve.mjs","--import","./server/node_modules/tsx/dist/loader.mjs","server/dist/index.js"]' ]]; then
    _pass "start_loads_serve_ahead_of_paperclip"
else
    _fail "start_loads_serve_ahead_of_paperclip" "entrypoint ${ENTRYPOINT}, command ${CMD}"
fi

HEALTHCHECK=$(docker image inspect --format '{{json .Config.Healthcheck.Test}}' "${IMAGE}")
if [[ "${HEALTHCHECK}" == '["CMD","node","/opt/paperclip-base-path/health.mjs"]' ]]; then
    _pass "declares_health_check"
else
    _fail "declares_health_check" "${HEALTHCHECK}"
fi

VOLUMES=$(docker image inspect --format '{{json .Config.Volumes}}' "${IMAGE}")
if [[ "${VOLUMES}" == *'"/paperclip"'* ]]; then
    _pass "declares_volume_paperclip"
else
    _fail "declares_volume_paperclip" "${VOLUMES}"
fi

# Each case: name, expected text, then the environment of the start.
_refuses() {
    local name="$1" expected="$2"
    shift 2
    local arguments=() output status
    for variable in "$@"; do arguments+=(-e "${variable}"); done
    output=$(timeout 120 docker run --rm --pull=never "${arguments[@]}" "${IMAGE}" 2>&1)
    status=$?
    if [[ ${status} -ne 0 && ${status} -ne 124 && "${output}" == *"${expected}"* ]]; then
        _pass "${name}"
    else
        _fail "${name}" "status ${status}: ${output}"
    fi
}

_refuses refuses_base_path_without_slash 'PAPERCLIP_BASE_PATH is "paperclip"' PAPERCLIP_BASE_PATH=paperclip
_refuses refuses_base_path_with_space 'PAPERCLIP_BASE_PATH is "/a b"' "PAPERCLIP_BASE_PATH=/a b"
_refuses refuses_base_path_with_dots 'PAPERCLIP_BASE_PATH is "/x/../y"' PAPERCLIP_BASE_PATH=/x/../y
_refuses refuses_public_url_without_base_path 'set PAPERCLIP_PUBLIC_URL to https://swarm-01/paperclip' \
    PAPERCLIP_BASE_PATH=/paperclip PAPERCLIP_PUBLIC_URL=https://swarm-01
_refuses refuses_missing_secret_file 'BETTER_AUTH_SECRET_FILE names /run/secrets/missing, which cannot be read' \
    BETTER_AUTH_SECRET_FILE=/run/secrets/missing
_refuses refuses_secret_set_twice 'BETTER_AUTH_SECRET and BETTER_AUTH_SECRET_FILE are both set' \
    BETTER_AUTH_SECRET=one BETTER_AUTH_SECRET_FILE=/etc/hostname

echo ""
echo "==> Image contract results: ${PASS} passed, ${FAIL} failed"
if [[ ${FAIL} -gt 0 ]]; then
    echo "==> Failed contracts: ${FAILED_NAMES[*]}"
    exit 1
fi
