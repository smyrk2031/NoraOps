"""Persist which implemented checks are enabled (admin CMS toggles)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from app.noraops.services.check_catalog import (
    CHECK_CATALOG,
    EXTENSION_CHECK_TRIGGERS,
    REQUIRED_CHECK_IDS,
    format_rule_spec,
)

_CHECKS_DIR = Path(__file__).resolve().parents[3] / "data" / "noraops" / "checks"
TOGGLES_FILE = "check-toggles.json"


def toggles_path() -> Path:
    return _CHECKS_DIR / TOGGLES_FILE


def _default_toggles() -> dict:
    return {
        "schema": "nora.check-toggles/1",
        "rules": {c["id"]: True for c in CHECK_CATALOG},
    }


def read_toggles_raw() -> dict:
    path = toggles_path()
    if not path.is_file():
        return _default_toggles()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _default_toggles()
    if not isinstance(data.get("rules"), dict):
        data["rules"] = {}
    return data


def read_toggles_map() -> dict[str, bool]:
    raw = read_toggles_raw()
    defaults = {c["id"]: True for c in CHECK_CATALOG}
    stored = raw.get("rules") or {}
    out = {**defaults}
    for k, v in stored.items():
        if isinstance(v, bool):
            out[str(k)] = v
    return out


def is_rule_enabled(rule_id: str) -> bool:
    return read_toggles_map().get(rule_id, True)


def filter_enabled_rules(rules: list) -> list:
    toggles = read_toggles_map()
    out = []
    for rule in rules:
        rid = rule.get("id")
        if rid in REQUIRED_CHECK_IDS:
            out.append(rule)
            continue
        if rid and toggles.get(rid) is False:
            continue
        out.append(rule)
    return out


def write_toggles(updates: dict[str, bool]) -> dict:
    """Merge toggle updates; unknown ids are ignored. Required checks stay ON."""
    known = {c["id"] for c in CHECK_CATALOG}
    current = read_toggles_map()
    for rid, enabled in updates.items():
        if rid not in known:
            continue
        if not isinstance(enabled, bool):
            continue
        if rid in REQUIRED_CHECK_IDS:
            current[rid] = True
        else:
            current[rid] = enabled
    for rid in REQUIRED_CHECK_IDS:
        current[rid] = True
    payload = {
        "schema": "nora.check-toggles/1",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "rules": current,
    }
    path = toggles_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    from app.noraops.services.rules_loader import clear_rules_cache

    clear_rules_cache()
    return payload


def checks_for_cms() -> dict:
    """Admin UI payload: catalog + current enabled state + deployed rule ids."""
    from app.noraops.services.rules_loader import _read_json_doc

    security_rules = _read_json_doc("security.rules.json").get("rules") or []
    policy_rules = _read_json_doc("repo-policy.rules.json").get("rules") or []
    all_rules = security_rules + policy_rules
    rule_by_id = {r.get("id"): r for r in all_rules if r.get("id")}
    deployed = set(rule_by_id.keys())
    toggles = read_toggles_map()
    checks = []
    for entry in CHECK_CATALOG:
        rid = entry["id"]
        rule_json = rule_by_id.get(rid)
        checks.append(
            {
                **entry,
                "enabled": True if rid in REQUIRED_CHECK_IDS else toggles.get(rid, True),
                "deployed": rid in deployed,
                "required": rid in REQUIRED_CHECK_IDS,
                "rule_spec": format_rule_spec(rule_json),
            }
        )
    return {
        "schema": "nora.checks-cms/2",
        "checks": checks,
        "extension_triggers": EXTENSION_CHECK_TRIGGERS,
        "maintenance": {
            "catalog": "app/noraops/services/check_catalog.py — タイトル・必須フラグ・CMS 説明",
            "rules_json": "data/noraops/checks/*.rules.json — 実行パラメータ（CMS 表示は自動マージ）",
            "toggles": "data/noraops/checks/check-toggles.json — ON/OFF のみ CMS が書く",
        },
        "rules_api": "/api/v1/checks/rules",
        "docs": "docs/CHECKS.md",
    }
