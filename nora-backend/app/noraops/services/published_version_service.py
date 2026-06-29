"""Runner 公開版（semver tag）の検証・記録・一覧。"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from packaging.version import InvalidVersion, Version
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import NoraOpsUser, PublishedVersion
from app.db.models import NoraOpsUser as _User  # noqa: F401 — typing

_TAG_RE = re.compile(r"^v?(\d+(?:\.\d+)*)$", re.IGNORECASE)


def normalize_version(raw: str) -> str:
    s = (raw or "").strip().lstrip("vV")
    if not s:
        raise ValueError("版番号を入力してください。")
    m = _TAG_RE.match(f"v{s}")
    if not m:
        raise ValueError("版番号は 1.0.0 形式（セマンティックバージョン）で指定してください。")
    try:
        return str(Version(s))
    except InvalidVersion as e:
        raise ValueError(f"版番号が不正です: {s}") from e


def version_to_tag(version: str) -> str:
    v = normalize_version(version)
    return f"v{v}"


def parse_version_key(version: str) -> Version:
    return Version(normalize_version(version))


def validate_version_bump(new_version: str, latest_version: str | None) -> str:
    """新しい版が最新以上であることを検証。正規化した版文字列を返す。"""
    normalized = normalize_version(new_version)
    if not latest_version:
        return normalized
    new_v = parse_version_key(normalized)
    old_v = parse_version_key(latest_version)
    if new_v < old_v:
        raise ValueError(
            f"版番号は最新の公開版（v{old_v}）以上にしてください。指定: v{new_v}"
        )
    if new_v == old_v:
        raise ValueError(
            f"v{old_v} は既に公開済みです。パッチ以上を上げてください（例: v{old_v.major}.{old_v.minor}.{old_v.micro + 1}）。"
        )
    return normalized


def suggest_next_version(latest_version: str | None, local_version: str | None = None) -> str:
    if latest_version:
        v = parse_version_key(latest_version)
        return f"{v.major}.{v.minor}.{v.micro + 1}"
    if local_version:
        try:
            v = parse_version_key(local_version)
            return f"{v.major}.{v.minor}.{v.micro + 1}"
        except ValueError:
            pass
    return "0.1.0"


def publisher_fields(user: NoraOpsUser | None, settings: Settings) -> tuple[str, str]:
    """(email, gitea_login)。open モードではメールは空。"""
    login = (user.gitea_login if user else "") or ""
    if settings.auth_mode_normalized == "open":
        return "", login
    email = (user.verified_email if user else "") or ""
    return email.strip(), login


def get_latest_published(db: Session, owner: str, name: str) -> PublishedVersion | None:
    rows = list_published_versions(db, owner, name)
    return rows[0] if rows else None


def list_published_versions(db: Session, owner: str, name: str) -> list[PublishedVersion]:
    o, n = owner.strip(), name.strip()
    stmt = (
        select(PublishedVersion)
        .where(PublishedVersion.owner == o, PublishedVersion.name == n)
        .order_by(PublishedVersion.published_at.desc())
    )
    rows = list(db.scalars(stmt).all())
    rows.sort(key=lambda r: parse_version_key(r.version), reverse=True)
    return rows


def record_published_version(
    db: Session,
    *,
    owner: str,
    name: str,
    version: str,
    tag: str,
    commit_sha: str,
    published_by_email: str,
    published_by_login: str,
) -> PublishedVersion:
    row = PublishedVersion(
        owner=owner.strip(),
        name=name.strip(),
        version=normalize_version(version),
        tag=tag,
        commit_sha=(commit_sha or "").strip(),
        published_by_email=(published_by_email or "").strip(),
        published_by_login=(published_by_login or "").strip(),
        published_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def publish_state_payload(
    db: Session,
    owner: str,
    name: str,
    *,
    local_version: str | None = None,
) -> dict[str, Any]:
    versions = list_published_versions(db, owner, name)
    latest = versions[0] if versions else None
    latest_ver = latest.version if latest else None
    return {
        "owner": owner,
        "name": name,
        "latestPublishedVersion": latest_ver,
        "latestPublishedTag": latest.tag if latest else None,
        "latestPublishedAt": latest.published_at.isoformat() if latest and latest.published_at else None,
        "latestPublisherEmail": latest.published_by_email if latest else "",
        "suggestedVersion": suggest_next_version(latest_ver, local_version),
        "publishedVersions": [version_row_to_dict(v) for v in versions],
    }


def version_row_to_dict(row: PublishedVersion) -> dict[str, Any]:
    return {
        "version": row.version,
        "tag": row.tag,
        "commitSha": row.commit_sha,
        "publishedAt": row.published_at.isoformat() if row.published_at else "",
        "publisherEmail": row.published_by_email or "",
        "publisherLogin": row.published_by_login or "",
    }


def catalog_version_summary(db: Session, owner: str, name: str) -> dict[str, Any]:
    versions = list_published_versions(db, owner, name)
    latest = versions[0] if versions else None
    return {
        "latestPublishedVersion": latest.version if latest else None,
        "latestPublishedTag": latest.tag if latest else None,
        "latestPublisherEmail": latest.published_by_email if latest else "",
        "latestPublishedAt": latest.published_at.isoformat() if latest and latest.published_at else None,
        "publishedVersions": [version_row_to_dict(v) for v in versions],
    }
