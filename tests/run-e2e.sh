#!/usr/bin/env bash
# End to end: starts the built image in tests/e2e/docker-compose.yml without
# internet access, once below the base path /paperclip behind Traefik without
# StripPrefix and once at the root, checks that the Better Auth secret reaches
# the containers as a file only, and runs the browser suite in Chromium.
#
# Usage: tests/run-e2e.sh   (after `npm run build`)

set -uo pipefail
cd "$(dirname "$0")/e2e"

export PAPERCLIP_E2E_BETTER_AUTH_SECRET="e2e-better-auth-secret-of-the-test-stack"
COMPOSE=(docker compose -f docker-compose.yml)
FAIL=0

cleanup() { "${COMPOSE[@]}" down -v --remove-orphans > /dev/null 2>&1; }
trap cleanup EXIT
cleanup

wait_healthy() {
    local service="$1" id
    id=$("${COMPOSE[@]}" ps -q "${service}")
    for _ in $(seq 1 120); do
        case "$(docker inspect --format '{{.State.Health.Status}}' "${id}" 2>/dev/null)" in
            healthy) return 0 ;;
            unhealthy) break ;;
        esac
        sleep 5
    done
    echo "  FAIL  ${service}_becomes_healthy: $(docker inspect --format '{{.State.Health.Status}}' "${id}")"
    "${COMPOSE[@]}" logs --tail 120 "${service}"
    return 1
}

echo "==> Paperclip end to end"
"${COMPOSE[@]}" build proxy browser || exit 1
"${COMPOSE[@]}" up -d paperclip paperclip-root proxy || exit 1
for service in paperclip paperclip-root; do
    wait_healthy "${service}" || exit 1
    echo "  PASS  ${service}_becomes_healthy_without_internet"
done

# the whole log first: grep -q stops at the first line, the logs command then
# dies on a closed pipe, and pipefail would count the match as a failure
LOG=$("${COMPOSE[@]}" logs paperclip)
if grep -q "paperclip: serving below /paperclip/" <<< "${LOG}"; then
    echo "  PASS  serves_below_the_base_path"
else
    echo "  FAIL  serves_below_the_base_path: the start did not report the base path"
    FAIL=1
fi

# the health check and the agents inside the container address it on
# localhost:3100 at the root, the base path does not move them; a request with
# a foreign hostname gets Paperclip's 403 for hosts it does not allow
for path in /api/health /paperclip/api/health; do
    HEALTH=$("${COMPOSE[@]}" exec -T paperclip node -e \
        "fetch('http://localhost:3100${path}').then(async r => console.log(r.status, await r.text()))" 2>&1)
    if [[ "${HEALTH}" == 200* ]] && grep -q '"status":"ok"' <<< "${HEALTH}"; then
        echo "  PASS  served_inside_the_container_at_${path}"
    else
        echo "  FAIL  served_inside_the_container_at_${path}: ${HEALTH}"
        FAIL=1
    fi
done

# the secret is a file under /run/secrets, never a value in the environment
for service in paperclip paperclip-root; do
    ENV=$(docker inspect --format '{{join .Config.Env "\n"}}' "$("${COMPOSE[@]}" ps -q "${service}")")
    if grep -q "${PAPERCLIP_E2E_BETTER_AUTH_SECRET}" <<< "${ENV}"; then
        echo "  FAIL  ${service}_secret_not_in_environment: the secret stands in the container environment"
        FAIL=1
    else
        echo "  PASS  ${service}_secret_not_in_environment"
    fi
done

# test_restart.py belongs after the restart below
"${COMPOSE[@]}" run --rm browser pytest -v --tb=short -W error -p no:cacheprovider test_base_path.py test_root.py || FAIL=1

# a new container on the same volume /paperclip knows the account of the first admin
"${COMPOSE[@]}" up -d --force-recreate paperclip || exit 1
wait_healthy paperclip || exit 1
"${COMPOSE[@]}" run --rm browser pytest -v --tb=short -W error -p no:cacheprovider test_restart.py || FAIL=1

if [[ ${FAIL} -ne 0 ]]; then
    "${COMPOSE[@]}" logs --tail 120 paperclip paperclip-root proxy
    exit 1
fi
echo "==> Paperclip end to end: green"
