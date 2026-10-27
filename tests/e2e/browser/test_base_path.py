"""Paperclip below the base path /paperclip, behind Traefik with
PathPrefix(`/paperclip`) and without StripPrefix, in Chromium."""
import socket
from urllib.parse import urlparse

import requests
from playwright.sync_api import Page

from conftest import (
    APP, EMAIL, LOCAL_URL, PREFIX, PROXY_URL, ROOT_ABSOLUTE_URLS,
    below, mounted, own, record, session_email, sign_in,
)


def outside(urls, origin=PROXY_URL):
    return [url for url in own(urls, origin) if not below(url)]


def test_bare_base_path_redirects_to_its_slash_form():
    for request, location in ((PREFIX, PREFIX + "/"), (PREFIX + "?next=%2F", PREFIX + "/?next=%2F")):
        response = requests.get(PROXY_URL + request, allow_redirects=False, timeout=10)
        assert response.status_code == 308, response.status_code
        assert response.headers["Location"] == location


def test_the_page_names_its_assets_below_the_base_path():
    html = requests.get(APP, timeout=10).text
    assert f'src="{PREFIX}/assets/' in html
    assert f'href="{PREFIX}/favicon' in html
    assert f"globalThis.__paperclipBasePath = \"{PREFIX}\"" in html
    assert f'<script src="{PREFIX}/paperclip-base-path.js"></script>' in html
    assert "__PAPERCLIP_BASE_PATH__" not in html


def test_nothing_outside_the_base_path_is_routed():
    assert requests.get(PROXY_URL + "/api/health", timeout=10).status_code == 404


def test_first_admin_signs_up_and_claims_below_the_base_path(admin_below_base_path):
    requested = admin_below_base_path["requested"]
    assert own(requested, PROXY_URL), "the page made no request to its own server"
    assert not outside(requested), f"requests left {PREFIX}: {outside(requested)}"
    api = {url: status for url, status in admin_below_base_path["responses"].items() if below(url, PREFIX + "/api")}
    assert any(below(url, PREFIX + "/api/auth/sign-up") and status == 200 for url, status in api.items()), api
    # the router took the admin from the claim page to the board, below the base path
    assert below(admin_below_base_path["url"]), admin_below_base_path["url"]


def test_sign_in_below_the_base_path(admin_below_base_path, page: Page):
    requested, responses = record(page)
    sign_in(page, PROXY_URL, PREFIX)
    assert below(page.url), page.url
    assert session_email(page) == EMAIL
    page.wait_for_load_state("networkidle")
    assert not outside(requested), f"requests left {PREFIX}: {outside(requested)}"
    assert any(below(url, PREFIX + "/api/auth/sign-in") and status == 200 for url, status in responses.items()), responses


def test_assets_load_below_the_base_path(page: Page):
    _, responses = record(page)
    page.goto(APP)
    mounted(page)
    page.wait_for_load_state("networkidle")
    assets = {url: status for url, status in responses.items() if below(url, PREFIX + "/assets")}
    assert any(url.endswith(".js") for url in assets), f"no bundle was loaded below the base path: {responses}"
    assert any(url.endswith(".css") for url in assets), f"no stylesheet was loaded below the base path: {responses}"
    # the API answers 401 for the session of a visitor; every file of the page answers 200
    files = {url: status for url, status in responses.items() if below(url) and not below(url, PREFIX + "/api")}
    failed = {url: status for url, status in files.items() if status >= 400}
    assert not failed, f"files failed: {failed}"


def test_document_names_no_url_outside_the_base_path(admin_below_base_path, page: Page):
    sign_in(page, PROXY_URL, PREFIX)
    page.wait_for_load_state("networkidle")
    named = [url for url in page.evaluate(ROOT_ABSOLUTE_URLS) if not below(url)]
    assert not named, f"the page names URLs outside {PREFIX}: {named}"


def test_deep_link_renders_below_the_base_path(page: Page):
    requested, responses = record(page)
    page.goto(APP + "auth?next=%2F")
    page.get_by_role("heading", name="Sign in to Paperclip").wait_for(timeout=30000)
    page.wait_for_load_state("networkidle")
    assert not outside(requested), f"requests left {PREFIX}: {outside(requested)}"
    deep = requests.get(APP + "PAP/issues/PAP-1", timeout=10)
    assert deep.status_code == 200
    assert f'src="{PREFIX}/assets/' in deep.text


def test_fetch_and_xhr_of_root_absolute_api_stay_below_the_base_path(page: Page):
    requested, _ = record(page)
    page.goto(APP)
    mounted(page)
    statuses = page.evaluate("""async () => {
        const xhr = await new Promise(resolve => {
            const request = new XMLHttpRequest()
            request.open('GET', '/api/health')
            request.onload = () => resolve(JSON.parse(request.responseText).status)
            request.send()
        })
        return [
            (await fetch('/api/health').then(r => r.json())).status,
            (await fetch(new Request('/api/health')).then(r => r.json())).status,
            (await fetch(new URL('/api/health', location.origin)).then(r => r.json())).status,
            (await fetch(location.origin + '/api/health').then(r => r.json())).status,
            xhr,
        ]
    }""")
    assert statuses == ["ok"] * 5
    health = [url for url in requested if urlparse(url).path.endswith("/api/health")]
    assert health and all(below(url) for url in health), health


def test_websocket_opens_below_the_base_path(admin_below_base_path, page: Page):
    requested, _ = record(page)
    sign_in(page, PROXY_URL, PREFIX)
    state = page.evaluate("""() => new Promise(resolve => {
        const socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/companies/e2e/events/ws')
        socket.onopen = () => { resolve(['open', socket.url]); socket.close() }
        socket.onerror = () => resolve(['error', socket.url])
    })""")
    assert state[0] == "open", state
    assert below(state[1]), state
    sockets = [url for url in requested if urlparse(url).scheme in ("ws", "wss")]
    assert sockets and all(below(url) for url in sockets), sockets


def test_websocket_upgrade_reaches_paperclip_only_below_the_base_path():
    def upgrade(path):
        """The answer to a websocket upgrade: status line, headers and body."""
        target = urlparse(PROXY_URL)
        with socket.create_connection((target.hostname, target.port), timeout=10) as connection:
            connection.sendall((f"GET {path} HTTP/1.1\r\nHost: {target.netloc}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n"
                                "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").encode())
            answer = b""
            while b"\r\n\r\n" not in answer and (chunk := connection.recv(4096)):
                answer += chunk
            head, _, body = answer.partition(b"\r\n\r\n")
            length = next((int(line.split(b":", 1)[1]) for line in head.split(b"\r\n")[1:]
                           if line.lower().startswith(b"content-length:")), None)
            while length is not None and len(body) < length and (chunk := connection.recv(4096)):
                body += chunk
            # the same answer comes chunked on arm64 (measured in the runner on 2026-10-27)
            if b"transfer-encoding: chunked" in head.lower():
                while not body.endswith(b"0\r\n\r\n") and (chunk := connection.recv(4096)):
                    body += chunk
                decoded = b""
                while (size := int(body.split(b"\r\n", 1)[0], 16)):
                    data = body.split(b"\r\n", 1)[1]
                    decoded += data[:size]
                    body = data[size + 2:]
                body = decoded
        return (head + b"\r\n\r\n" + body).decode(errors="replace")

    # Paperclip refuses the live events of a company without a session
    answer = upgrade(PREFIX + "/api/companies/e2e/events/ws")
    assert answer.startswith("HTTP/1.1 403"), answer
    assert answer.rstrip().endswith("forbidden"), answer
    assert upgrade("/api/companies/e2e/events/ws").startswith("HTTP/1.1 404"), "the proxy routed a path outside the base path"


def test_event_source_stays_below_the_base_path(page: Page):
    requested, _ = record(page)
    page.goto(APP)
    mounted(page)
    url = page.evaluate("""() => new Promise(resolve => {
        const source = new EventSource('/api/health')
        source.onerror = () => { source.close(); resolve(source.url) }
        source.onopen = () => { source.close(); resolve(source.url) }
    })""")
    assert below(url), url
    assert any(urlparse(entry).path == PREFIX + "/api/health" for entry in requested), requested


def test_redirect_of_paperclip_keeps_the_base_path():
    # upstream's static files answer a directory without its slash with a redirect
    response = requests.get(PROXY_URL + PREFIX + "/fonts", allow_redirects=False, timeout=10)
    assert response.status_code in (301, 302, 307, 308), response.status_code
    assert response.headers["Location"] == PREFIX + "/fonts/"


def test_links_history_and_windows_keep_the_base_path(page: Page):
    page.goto(APP)
    mounted(page)
    results = page.evaluate("""() => {
        const link = document.createElement('a')
        link.href = '/PAP/issues'
        const attribute = document.createElement('a')
        attribute.setAttribute('href', '/api/assets/x.png')
        const image = new Image()
        image.src = '/brands/x.svg'
        history.pushState(null, '', '/PAP/dashboard')
        const pushed = location.pathname
        history.replaceState(null, '', '/')
        return [link.href, attribute.getAttribute('href'), image.src, pushed, location.pathname]
    }""")
    assert results == [APP + "PAP/issues", PREFIX + "/api/assets/x.png", APP + "brands/x.svg", PREFIX + "/PAP/dashboard", PREFIX + "/"]
    with page.context.expect_page() as popup:
        page.evaluate("window.open('/api/health')")
    popup.value.wait_for_load_state()
    assert popup.value.url == APP + "api/health"


def test_document_navigation_to_a_root_absolute_address_stays_below_the_base_path(page: Page):
    page.goto(APP)
    mounted(page)
    page.evaluate("location.href = '/auth?next=%2F'")
    page.wait_for_url(lambda url: urlparse(url).path == PREFIX + "/auth", timeout=30000)
    page.get_by_role("heading", name="Sign in to Paperclip").wait_for(timeout=30000)


def test_foreign_relative_and_prefixed_urls_stay_unchanged(page: Page):
    page.goto(APP)
    mounted(page)
    results = page.evaluate(f"""[
        globalThis.__paperclipRebase('https://example.org/api/v1/x'),
        globalThis.__paperclipRebase('//cdn.example.org/x.js'),
        globalThis.__paperclipRebase('{PREFIX}/api/x'),
        globalThis.__paperclipRebase('relative/path'),
        globalThis.__paperclipRebase('data:image/png;base64,AAAA'),
        globalThis.__paperclipRebase('#section'),
    ]""")
    assert results == [
        "https://example.org/api/v1/x",
        "//cdn.example.org/x.js",
        f"{PREFIX}/api/x",
        "relative/path",
        "data:image/png;base64,AAAA",
        "#section",
    ]


def test_service_worker_registers_below_the_base_path(page: Page):
    # localhost is a secure context, where the service worker API exists;
    # the interface registers its worker when the page has loaded
    page.goto(LOCAL_URL + PREFIX + "/")
    mounted(page)
    page.wait_for_function("navigator.serviceWorker.getRegistration().then(r => !!r)", timeout=30000)
    registration = page.evaluate("navigator.serviceWorker.getRegistration().then(r => [r.scope, (r.active || r.installing || r.waiting).scriptURL])")
    assert registration == [LOCAL_URL + PREFIX + "/", LOCAL_URL + PREFIX + "/sw.js"]
