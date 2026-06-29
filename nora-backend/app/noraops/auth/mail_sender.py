"""メール送信（SMTP / 自社 HTTP エンドポイント）。"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)


class MailDeliveryError(Exception):
    pass


def send_mail(
    settings: Settings,
    *,
    to_addr: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> None:
    provider = (settings.noraops_mail_provider or "smtp").strip().lower()
    if provider in ("http", "api", "webhook"):
        _send_http(settings, to_addr=to_addr, subject=subject, body_text=body_text, body_html=body_html)
        return
    _send_smtp(settings, to_addr=to_addr, subject=subject, body_text=body_text, body_html=body_html)


def _send_smtp(
    settings: Settings,
    *,
    to_addr: str,
    subject: str,
    body_text: str,
    body_html: str | None,
) -> None:
    host = (settings.noraops_smtp_host or "").strip()
    if not host:
        logger.warning(
            "Mail not sent (SMTP unset); to=%s subject=%s body=%s",
            to_addr,
            subject,
            body_text.replace("\n", " ")[:200],
        )
        return

    msg = EmailMessage()
    from_addr = (settings.noraops_smtp_from or settings.noraops_smtp_user or "noreply@noraops").strip()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    port = int(settings.noraops_smtp_port or 587)
    user = (settings.noraops_smtp_user or "").strip()
    password = settings.noraops_smtp_password or ""
    use_tls = settings.noraops_smtp_use_tls

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        if use_tls:
            smtp.starttls()
        if user:
            smtp.login(user, password)
        smtp.send_message(msg)


def _send_http(
    settings: Settings,
    *,
    to_addr: str,
    subject: str,
    body_text: str,
    body_html: str | None,
) -> None:
    url = (settings.noraops_mail_http_url or "").strip()
    if not url:
        logger.warning(
            "Mail not sent (HTTP URL unset); to=%s subject=%s",
            to_addr,
            subject,
        )
        return

    # 自社汎用メール API: POST {url} with JSON
    # { "to": ["user@example.com"], "subject": "...", "body": "...", "is_html": false }
    is_html = bool(body_html)
    payload = {
        "to": [to_addr.strip()],
        "subject": subject,
        "body": body_html if is_html else body_text,
        "is_html": is_html,
    }

    headers = {"Content-Type": "application/json"}
    api_key = (settings.noraops_mail_http_api_key or "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        with httpx.Client(timeout=30.0, trust_env=settings.noraops_http_trust_env) as client:
            resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
    except httpx.HTTPError as e:
        raise MailDeliveryError(f"メール API エラー: {e}") from e
