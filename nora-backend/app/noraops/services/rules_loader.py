"""Load check rule bundles from data/noraops/checks."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

_DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "noraops" / "checks"


def _read_json(name: str) -> dict:
    return _read_json_rules(name)


def _read_json_rules(name: str) -> list:
    path = _DATA_DIR / name
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("rules") or []


def _read_json_doc(name: str) -> dict:
    path = _DATA_DIR / name
    if not path.is_file():
        return {"schema": "nora.rules/1", "rules": []}
    return json.loads(path.read_text(encoding="utf-8"))


def clear_rules_cache() -> None:
    load_rules_bundle.cache_clear()


@lru_cache(maxsize=1)
def load_rules_bundle() -> dict:
    from app.noraops.services.check_toggles import filter_enabled_rules
    from app.noraops.services.security_allowlist import merge_security_allowlist

    security_doc = merge_security_allowlist(_read_json_doc("security.rules.json"))
    repo_policy_doc = _read_json_doc("repo-policy.rules.json")
    security_doc = {
        **security_doc,
        "rules": filter_enabled_rules(security_doc.get("rules") or []),
    }
    repo_policy_doc = {
        **repo_policy_doc,
        "rules": filter_enabled_rules(repo_policy_doc.get("rules") or []),
    }
    payload = {
        "schema": "nora.rules-bundle/1",
        "security": security_doc,
        "repo_policy": repo_policy_doc,
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    etag = hashlib.sha256(raw).hexdigest()[:32]
    version = etag[:12]
    return {
        "schema": "nora.rules-bundle/1",
        "version": version,
        "etag": etag,
        "security": security_doc,
        "repo_policy": repo_policy_doc,
    }
