"""基本プロンプトカタログ — 配布 API + CMS 編集。"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

_SERVER_ROOT = Path(__file__).resolve().parents[3]
_CATALOG_REL = Path("data/noraops/prompts/builtin-catalog.json")
_BOOTSTRAP_REL = Path("bootstrap_data/noraops/prompts/builtin-catalog.json")

KEY_RE = re.compile(r"^[a-z][a-z0-9._-]{0,79}$")
ALLOWED_CATEGORIES = frozenset({"creator", "xllm", "custom"})


def catalog_path() -> Path:
    return (_SERVER_ROOT / _CATALOG_REL).resolve()


def bootstrap_catalog_path() -> Path:
    return (_SERVER_ROOT / _BOOTSTRAP_REL).resolve()


def ensure_data_catalog_from_bootstrap() -> bool:
    """data/ にカタログが無ければ bootstrap からコピー。"""
    dest = catalog_path()
    if dest.is_file() and dest.stat().st_size > 10:
        return False
    src = bootstrap_catalog_path()
    if not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def load_builtin_catalog() -> tuple[dict[str, Any], str]:
    ensure_data_catalog_from_bootstrap()
    for path in (catalog_path(), bootstrap_catalog_path()):
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
            if isinstance(data, dict) and isinstance(data.get("prompts"), list):
                ver = str(data.get("version") or "0.21.0")
                return data, ver
        except (OSError, json.JSONDecodeError, TypeError):
            continue
    return {"version": "0.21.0", "prompts": []}, "0.21.0"


def read_catalog_for_cms() -> dict[str, Any]:
    catalog, ver = load_builtin_catalog()
    out = dict(catalog)
    out["version"] = ver
    out.setdefault("prompts", [])
    return out


def _normalize_prompt_entry(raw: dict[str, Any], index: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"prompts[{index}] はオブジェクトである必要があります")
    key = str(raw.get("key") or "").strip()
    if not KEY_RE.match(key):
        raise ValueError(f"prompts[{index}].key が不正です: {key!r}")
    title = str(raw.get("title") or "").strip()
    if not title:
        raise ValueError(f"prompts[{index}].title が空です")
    category = str(raw.get("category") or "xllm").strip().lower()
    if category not in ALLOWED_CATEGORIES:
        raise ValueError(f"prompts[{index}].category が不正です: {category}")
    try:
        order = int(raw.get("order", index * 10))
    except (TypeError, ValueError) as e:
        raise ValueError(f"prompts[{index}].order が数値ではありません") from e
    dynamic = bool(raw.get("dynamic"))
    body = raw.get("body")
    body_str = None if body is None else str(body)
    if dynamic:
        body_str = None
    legacy = raw.get("legacyMode")
    legacy_mode = str(legacy).strip() if legacy else None
    if legacy_mode == "":
        legacy_mode = None
    description = str(raw.get("description") or "").strip() or None
    resolver = str(raw.get("resolver") or "").strip() or None
    return {
        "key": key,
        "title": title[:200],
        "category": category,
        "showInXllm": bool(raw.get("showInXllm")),
        "order": order,
        "dynamic": dynamic,
        "legacyMode": legacy_mode,
        "description": description,
        "defaultEnabled": raw.get("defaultEnabled") is not False,
        "body": body_str,
        **({"resolver": resolver} if resolver else {}),
    }


def validate_catalog(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("カタログは JSON オブジェクトである必要があります")
    version = str(data.get("version") or "").strip()
    if not version:
        raise ValueError("version が必要です")
    prompts_raw = data.get("prompts")
    if not isinstance(prompts_raw, list):
        raise ValueError("prompts は配列である必要があります")
    prompts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, row in enumerate(prompts_raw):
        norm = _normalize_prompt_entry(row, i)
        if norm["key"] in seen:
            raise ValueError(f"重複 key: {norm['key']}")
        seen.add(norm["key"])
        prompts.append(norm)
    prompts.sort(key=lambda p: (p.get("order", 0), p.get("key", "")))
    return {"version": version, "prompts": prompts}


def validate_and_write_catalog(data: dict[str, Any]) -> str:
    normalized = validate_catalog(data)
    path = catalog_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return normalized["version"]
