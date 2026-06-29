"""Admin workflow status for unapproved / candidate packages."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from app.services.data_bootstrap import resolve_data_root
from app.services.package_allowlist import normalize_pkg_name

SCHEMA = "nora.package-review-status/1"
_STATUS_REL = "noraops/packages/review-status.json"

REVIEW_STATUSES = ("todo", "considering", "reviewing", "rejected", "approved")

REVIEW_STATUS_LABELS: dict[str, str] = {
    "todo": "Todo",
    "considering": "検討中",
    "reviewing": "審査中",
    "rejected": "却下",
    "approved": "許可",
}


def review_status_path():
    return resolve_data_root() / _STATUS_REL


def _empty_document() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {"schema": SCHEMA, "updatedAt": now, "packages": {}}


def load_review_status() -> dict:
    path = review_status_path()
    if not path.is_file():
        return _empty_document()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty_document()
    if not isinstance(data, dict):
        return _empty_document()
    data.setdefault("schema", SCHEMA)
    data.setdefault("packages", {})
    if not isinstance(data["packages"], dict):
        data["packages"] = {}
    return data


def save_review_status(data: dict) -> dict:
    path = review_status_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data["schema"] = SCHEMA
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def normalize_status(status: str | None) -> str:
    s = str(status or "todo").strip().lower()
    return s if s in REVIEW_STATUSES else "todo"


def get_package_review(name: str, data: dict | None = None) -> dict[str, Any]:
    data = data or load_review_status()
    key = normalize_pkg_name(name)
    row = (data.get("packages") or {}).get(key) or {}
    return {
        "package": key,
        "status": normalize_status(row.get("status")),
        "note": str(row.get("note") or ""),
        "updatedAt": row.get("updatedAt"),
        "updatedBy": row.get("updatedBy") or "",
    }


def set_package_review(
    name: str,
    status: str,
    *,
    note: str | None = None,
    updated_by: str = "admin",
) -> dict[str, Any]:
    key = normalize_pkg_name(name)
    if not key:
        raise ValueError("パッケージ名が空です")
    st = normalize_status(status)
    if str(status or "").strip().lower() not in REVIEW_STATUSES:
        raise ValueError(f"status は {', '.join(REVIEW_STATUSES)} のいずれかです")
    data = load_review_status()
    packages = dict(data.get("packages") or {})
    prev = packages.get(key) or {}
    now = datetime.now(timezone.utc).isoformat()
    entry = {
        "status": st,
        "note": str(note if note is not None else prev.get("note") or ""),
        "updatedAt": now,
        "updatedBy": updated_by,
    }
    packages[key] = entry
    data["packages"] = packages
    save_review_status(data)
    return {"package": key, **entry}


def list_review_records(data: dict | None = None) -> dict[str, dict[str, Any]]:
    data = data or load_review_status()
    out: dict[str, dict[str, Any]] = {}
    for name, row in (data.get("packages") or {}).items():
        if not isinstance(row, dict):
            continue
        key = normalize_pkg_name(name)
        if not key:
            continue
        out[key] = {
            "status": normalize_status(row.get("status")),
            "note": str(row.get("note") or ""),
            "updatedAt": row.get("updatedAt"),
            "updatedBy": row.get("updatedBy") or "",
        }
    return out
