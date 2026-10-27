"""The account of the first admin in the volume /paperclip: tests/run-e2e.sh
runs this file once more after it recreated the container on the same volume."""
from playwright.sync_api import Page

from conftest import EMAIL, PROXY_URL, PREFIX, below, session_email, sign_in


def test_account_signs_in_from_the_volume(page: Page):
    sign_in(page, PROXY_URL, PREFIX)
    assert below(page.url), page.url
    assert session_email(page) == EMAIL
