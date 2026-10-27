"""The same image without PAPERCLIP_BASE_PATH: Paperclip at the root, as
upstream serves it, in Chromium."""
from urllib.parse import urlparse

import requests
from playwright.sync_api import Page

from conftest import EMAIL, PREFIX, ROOT_ABSOLUTE_URLS, ROOT_URL, own, record, session_email, sign_in


def test_the_page_names_its_assets_at_the_root():
    html = requests.get(ROOT_URL + "/", timeout=10).text
    assert 'src="/assets/' in html
    assert 'href="/favicon' in html
    assert "__PAPERCLIP_BASE_PATH__" not in html
    assert "paperclip-base-path.js" not in html


def test_first_admin_signs_up_and_claims_at_the_root(admin_at_root):
    requested = own(admin_at_root["requested"], ROOT_URL)
    assert requested, "the page made no request to its own server"
    prefixed = [url for url in requested if urlparse(url).path.startswith(PREFIX + "/")]
    assert not prefixed, f"the root asked for {PREFIX}: {prefixed}"
    assets = {url: status for url, status in admin_at_root["responses"].items() if urlparse(url).path.startswith("/assets/")}
    assert assets and set(assets.values()) == {200}, f"assets at the root: {assets}"
    assert urlparse(admin_at_root["url"]).path not in ("/", "/auth"), admin_at_root["url"]


def test_sign_in_at_the_root(admin_at_root, page: Page):
    requested, _ = record(page)
    sign_in(page, ROOT_URL, "")
    assert session_email(page) == EMAIL
    page.wait_for_load_state("networkidle")
    named = [url for url in page.evaluate(ROOT_ABSOLUTE_URLS) if "__PAPERCLIP_BASE_PATH__" in url or url.startswith(PREFIX + "/")]
    assert not named, f"the root page names {named}"
    prefixed = [url for url in own(requested, ROOT_URL) if urlparse(url).path.startswith(PREFIX + "/")]
    assert not prefixed, prefixed


def test_redirect_at_the_root_stays_as_upstream_writes_it():
    response = requests.get(ROOT_URL + "/fonts", allow_redirects=False, timeout=10)
    assert response.status_code in (301, 302, 307, 308), response.status_code
    assert response.headers["Location"] == "/fonts/"
