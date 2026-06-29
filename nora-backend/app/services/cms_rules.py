"""CMS: チェック有効/無効 · プロンプト · MCP 参照。"""

from __future__ import annotations

import json
from pathlib import Path

from app.noraops.services.concierge_prompt_template import read_template_for_edit
from app.noraops.services.env_prompt_template import read_template_for_edit as read_env_prompt_for_edit
_CHECKS_DIR = Path(__file__).resolve().parents[2] / "data" / "noraops" / "checks"
_MCP_DIR = Path(__file__).resolve().parents[2] / "data" / "noraops" / "mcp"

SECURITY_FILE = "security.rules.json"
REPO_POLICY_FILE = "repo-policy.rules.json"
MCP_SOURCES_FILE = "sources.json"
MCP_EXAMPLE_FILE = "sources.example.json"


def checks_dir() -> Path:
    return _CHECKS_DIR


def mcp_dir() -> Path:
    _MCP_DIR.mkdir(parents=True, exist_ok=True)
    return _MCP_DIR


def read_rule_file(name: str) -> str:
    """開発・bootstrap 用。CMS からは直接編集しない。"""
    path = checks_dir() / name
    if not path.is_file():
        return json.dumps({"schema": "nora.rules/1", "rules": []}, ensure_ascii=False, indent=2)
    return path.read_text(encoding="utf-8")


def write_rule_file(name: str, content: str) -> None:
    if name not in (SECURITY_FILE, REPO_POLICY_FILE):
        raise ValueError("invalid rules file name")
    parsed = json.loads(content)
    if "rules" not in parsed:
        raise ValueError("JSON must contain a 'rules' array")
    if name == SECURITY_FILE:
        from app.noraops.services.security_allowlist import merge_security_allowlist

        parsed = merge_security_allowlist(parsed)
    path = checks_dir() / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    from app.noraops.services.rules_loader import clear_rules_cache

    clear_rules_cache()


def read_mcp_sources_parsed() -> dict:
    mdir = mcp_dir()
    path = mdir / MCP_SOURCES_FILE
    if not path.is_file():
        path = mdir / MCP_EXAMPLE_FILE
    if not path.is_file():
        return {"schema": "nora.mcp-sources/1", "sources": []}
    return json.loads(path.read_text(encoding="utf-8"))


def read_mcp_sources() -> str:
    return json.dumps(read_mcp_sources_parsed(), ensure_ascii=False, indent=2)


def write_mcp_sources(content: str) -> None:
    parsed = json.loads(content)
    if isinstance(parsed, list):
        parsed = {"schema": "nora.mcp-sources/1", "sources": parsed}
    elif not isinstance(parsed.get("sources"), list):
        raise ValueError("JSON must contain a 'sources' array")
    path = mcp_dir() / MCP_SOURCES_FILE
    path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


CONCIERGE_PROMPT_FILE = "data/noraops/concierge/copilot-prompt-template.md"
ENV_PROMPT_FILE = "data/noraops/prompts/env-deps-prompt-template.md"


def cms_snapshot() -> dict[str, str]:
    mcp = read_mcp_sources_parsed()
    return {
        "concierge_prompt_markdown": read_template_for_edit(),
        "env_prompt_markdown": read_env_prompt_for_edit(),
        "rules_api_path": "/api/v1/checks/rules",
        "checks_api_path": "/api/admin/cms/checks",
        "concierge_prompt_api_path": "/api/v1/noraops/concierge/prompt-template",
        "env_prompt_api_path": "/api/v1/noraops/prompts/env-deps",
        "security_file": f"data/noraops/checks/{SECURITY_FILE}",
        "repo_policy_file": f"data/noraops/checks/{REPO_POLICY_FILE}",
        "toggles_file": "data/noraops/checks/check-toggles.json",
        "mcp_file": f"data/noraops/mcp/{MCP_SOURCES_FILE}",
        "concierge_prompt_file": CONCIERGE_PROMPT_FILE,
        "env_prompt_file": ENV_PROMPT_FILE,
        "mcp_sources_count": str(len(mcp.get("sources") or [])),
    }
