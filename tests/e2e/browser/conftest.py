"""Shared settings of the browser suite: addresses, readiness, the first admin.

The proxy and the containers are reached by their service names, which
Chromium treats as insecure origins, so the service worker API does not exist
there. Every address on localhost counts as a secure context, so the suite
forwards LOCAL_URL (localhost:8080) to the proxy and loads the page from there
where it needs the service worker.
"""
import os
import socket
import socketserver
import threading
import time
from urllib.parse import urlparse

import pytest
import requests

PROXY_URL = os.environ.get("PROXY_URL", "http://proxy:8080").rstrip("/")
PREFIX = os.environ.get("PREFIX", "/paperclip")
ROOT_URL = os.environ.get("ROOT_URL", "http://paperclip-root:3100").rstrip("/")
LOCAL_PORT = 8080
LOCAL_URL = f"http://localhost:{LOCAL_PORT}"
APP = PROXY_URL + PREFIX + "/"

NAME = "E2E Admin"
EMAIL = "admin@e2e.example"
PASSWORD = "e2e-password-of-the-test-stack"

# every root-absolute URL the rendered document names, in any element
ROOT_ABSOLUTE_URLS = """() => [...document.querySelectorAll('[src],[href],[action]')]
    .flatMap(element => ['src', 'href', 'action'].map(name => element.getAttribute(name)))
    .filter(value => value && value.startsWith('/') && !value.startsWith('//'))"""


def wait_for(url, timeout=300):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            response = requests.get(url, timeout=5)
            if response.status_code == 200 and response.json().get("status") == "ok":
                return
            last = f"status {response.status_code}: {response.text[:200]}"
        except (requests.RequestException, ValueError) as error:
            last = error
        time.sleep(2)
    raise TimeoutError(f"{url} did not report ok within {timeout}s: {last}")


def below(url, prefix=PREFIX):
    path = urlparse(url).path
    return path == prefix or path.startswith(prefix + "/")


def own(urls, origin):
    netloc = urlparse(origin).netloc
    return [url for url in urls if urlparse(url).scheme in ("http", "https", "ws", "wss") and urlparse(url).netloc == netloc]


def record(page):
    """Every request, response and websocket of the page, from now on."""
    requested, responses = [], {}
    page.on("request", lambda request: requested.append(request.url))
    page.on("response", lambda response: responses.__setitem__(response.url, response.status))
    page.on("websocket", lambda websocket: requested.append(websocket.url))
    return requested, responses


def mounted(page):
    page.wait_for_function("document.getElementById('root') && document.getElementById('root').children.length > 0", timeout=30000)


def sign_up_and_claim(page, origin, prefix):
    """On a new instance: create the first account through the page and claim
    the instance with it, as its first admin does."""
    page.goto(origin + prefix + "/")
    page.get_by_role("link", name="Sign in / Create account").click()
    page.wait_for_url(lambda url: urlparse(url).path == prefix + "/auth")
    page.get_by_role("button", name="Create one").click()
    page.fill("#name", NAME)
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    page.get_by_role("button", name="Create Account").click()
    page.get_by_role("button", name="Claim this instance").wait_for(timeout=30000)
    page.get_by_role("button", name="Claim this instance").click()
    # the admin leaves the claim page for the start of the board
    page.wait_for_url(lambda url: urlparse(url).path not in (prefix + "/", prefix + "/auth"), timeout=30000)


def sign_in(page, origin, prefix):
    page.goto(origin + prefix + "/auth")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    with page.expect_response(lambda response: "/api/auth/sign-in" in response.url) as answer:
        page.get_by_role("button", name="Sign In").click()
    response = answer.value
    assert response.ok, f"sign-in answered {response.status}: {response.text()[:300]}"
    page.wait_for_url(lambda url: not urlparse(url).path.startswith(prefix + "/auth"), timeout=30000)


def session_email(page):
    return page.evaluate("fetch('/api/auth/get-session', { credentials: 'include' }).then(r => r.json()).then(s => s && s.user && s.user.email)")


class Forward(socketserver.BaseRequestHandler):
    """Relay one TCP connection from the local port to the proxy."""

    def handle(self):
        target = urlparse(PROXY_URL)
        with socket.create_connection((target.hostname, target.port or 80)) as upstream:
            def pump(source, sink):
                try:
                    while data := source.recv(65536):
                        sink.sendall(data)
                except OSError:
                    pass
                finally:
                    try:
                        sink.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass

            back = threading.Thread(target=pump, args=(upstream, self.request), daemon=True)
            back.start()
            pump(self.request, upstream)
            back.join()


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


@pytest.fixture(scope="session", autouse=True)
def services_ready():
    wait_for(PROXY_URL + PREFIX + "/api/health")
    wait_for(ROOT_URL + "/api/health")
    server = Server(("127.0.0.1", LOCAL_PORT), Forward)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    wait_for(LOCAL_URL + PREFIX + "/api/health")
    yield
    server.shutdown()
    server.server_close()


@pytest.fixture(scope="session")
def admin_below_base_path(browser):
    """The first admin of the instance below the base path, with every request
    the page made on the way."""
    context = browser.new_context()
    page = context.new_page()
    requested, responses = record(page)
    sign_up_and_claim(page, PROXY_URL, PREFIX)
    page.wait_for_load_state("networkidle")
    yield {"requested": list(requested), "responses": dict(responses), "url": page.url}
    context.close()


@pytest.fixture(scope="session")
def admin_at_root(browser):
    context = browser.new_context()
    page = context.new_page()
    requested, responses = record(page)
    sign_up_and_claim(page, ROOT_URL, "")
    page.wait_for_load_state("networkidle")
    yield {"requested": list(requested), "responses": dict(responses), "url": page.url}
    context.close()
