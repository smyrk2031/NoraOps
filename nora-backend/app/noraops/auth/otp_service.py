"""Email OTP generation, verification, and SMTP delivery."""

from __future__ import annotations

import hashlib
import logging
import random
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import NoraOpsOtpChallenge
from app.noraops.auth.email_util import normalize_email

logger = logging.getLogger(__name__)

MAX_OTP_ATTEMPTS = 5
RATE_LIMIT_COUNT = 3
RATE_LIMIT_WINDOW_MINUTES = 15


def _hash_otp(otp: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{otp}".encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


class OtpRateLimitError(Exception):
    pass


class OtpService:
    def _check_rate_limit(self, db: Session, email: str) -> None:
        since = _naive_utc(_utcnow() - timedelta(minutes=RATE_LIMIT_WINDOW_MINUTES))
        count = db.scalar(
            select(func.count())
            .select_from(NoraOpsOtpChallenge)
            .where(
                NoraOpsOtpChallenge.email_normalized == email,
                NoraOpsOtpChallenge.created_at >= since,
            )
        )
        if count and int(count) >= RATE_LIMIT_COUNT:
            raise OtpRateLimitError("Too many OTP requests. Try again later.")

    def request_otp(self, db: Session, settings: Settings, email: str) -> str:
        norm = normalize_email(email)
        if not norm or "@" not in norm:
            raise ValueError("Invalid email address")
        self._check_rate_limit(db, norm)

        otp = f"{random.randint(0, 999999):06d}"
        salt = secrets.token_hex(8)
        ttl = max(1, int(settings.noraops_otp_ttl_minutes))
        expires = _naive_utc(_utcnow() + timedelta(minutes=ttl))

        db.execute(
            delete(NoraOpsOtpChallenge).where(
                NoraOpsOtpChallenge.email_normalized == norm,
                NoraOpsOtpChallenge.consumed == False,  # noqa: E712
            )
        )
        db.add(
            NoraOpsOtpChallenge(
                email_normalized=norm,
                otp_hash=f"{salt}${_hash_otp(otp, salt)}",
                expires_at=expires,
            )
        )
        db.commit()

        self._send_email(settings, norm, otp)
        return norm

    def verify_otp(self, db: Session, email: str, otp: str) -> bool:
        norm = normalize_email(email)
        code = (otp or "").strip()
        if not norm or len(code) != 6 or not code.isdigit():
            return False

        challenge = db.scalar(
            select(NoraOpsOtpChallenge)
            .where(
                NoraOpsOtpChallenge.email_normalized == norm,
                NoraOpsOtpChallenge.consumed == False,  # noqa: E712
            )
            .order_by(NoraOpsOtpChallenge.id.desc())
            .limit(1)
        )
        if not challenge:
            return False

        now = _utcnow()
        expires = challenge.expires_at.replace(tzinfo=timezone.utc) if challenge.expires_at.tzinfo is None else challenge.expires_at
        if now > expires:
            challenge.consumed = True
            db.commit()
            return False

        if challenge.attempts >= MAX_OTP_ATTEMPTS:
            challenge.consumed = True
            db.commit()
            return False

        stored = challenge.otp_hash
        if "$" in stored:
            salt, digest = stored.split("$", 1)
        else:
            salt, digest = "", stored
        challenge.attempts += 1
        if _hash_otp(code, salt) != digest:
            db.commit()
            return False

        challenge.consumed = True
        db.commit()
        return True

    def _send_email(self, settings: Settings, to_addr: str, otp: str) -> None:
        host = (settings.noraops_smtp_host or "").strip()
        if not host:
            logger.warning("NORAOPS_SMTP_HOST not set; OTP for %s is %s (dev only)", to_addr, otp)
            return

        msg = EmailMessage()
        from_addr = (settings.noraops_smtp_from or settings.noraops_smtp_user or "noreply@noraops").strip()
        msg["From"] = from_addr
        msg["To"] = to_addr
        msg["Subject"] = "NoraOps ログインコード"
        msg.set_content(
            f"NoraOps ログインコード: {otp}\n\n"
            f"有効期限: {settings.noraops_otp_ttl_minutes} 分\n"
            "このコードを他人に教えないでください。"
        )

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


_otp_service: OtpService | None = None


def get_otp_service() -> OtpService:
    global _otp_service
    if _otp_service is None:
        _otp_service = OtpService()
    return _otp_service
