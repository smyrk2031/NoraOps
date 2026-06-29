"""Mail sender HTTP provider payload."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.core.config import Settings
from app.noraops.auth.mail_sender import send_mail


def test_send_mail_http_posts_generic_payload():
    settings = Settings(
        NORAOPS_MAIL_PROVIDER="http",
        NORAOPS_MAIL_HTTP_URL="https://mail-api.corp.example.com/send_mail",
    )
    captured: dict = {}

    def _fake_post(url, *, json, headers):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        return resp

    mock_client = MagicMock()
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)
    mock_client.post = _fake_post

    with patch("app.noraops.auth.mail_sender.httpx.Client", return_value=mock_client):
        send_mail(
            settings,
            to_addr="aaa@mail.co.jp",
            subject="テスト件名",
            body_text="プレーンテキスト",
            body_html=None,
        )

    assert captured["url"] == "https://mail-api.corp.example.com/send_mail"
    assert captured["json"] == {
        "to": ["aaa@mail.co.jp"],
        "subject": "テスト件名",
        "body": "プレーンテキスト",
        "is_html": False,
    }
    assert captured["headers"]["Content-Type"] == "application/json"


def test_send_mail_http_uses_html_body_when_provided():
    settings = Settings(
        NORAOPS_MAIL_PROVIDER="http",
        NORAOPS_MAIL_HTTP_URL="http://127.0.0.1:9000/send_mail",
    )
    captured: dict = {}

    mock_client = MagicMock()
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)
    mock_client.post = lambda url, *, json, headers: captured.update({"json": json}) or MagicMock(
        raise_for_status=MagicMock()
    )

    with patch("app.noraops.auth.mail_sender.httpx.Client", return_value=mock_client):
        send_mail(
            settings,
            to_addr="user@corp.example.com",
            subject="件名",
            body_text="plain",
            body_html="<p>html</p>",
        )

    assert captured["json"]["body"] == "<p>html</p>"
    assert captured["json"]["is_html"] is True
