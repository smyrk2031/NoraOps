"""管理者向け Q&A 検索（FAQ manifest + 既存ヘルプ MD の再利用）。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.services.help_catalog import _read_md_file, list_help_tabs

_MANIFEST_REL = Path("docs") / "admin-help" / "manifest.json"
_TOKEN_SPLIT = re.compile(r"[\s　,、。]+")
_MD_NOISE = re.compile(r"[#>*`\[\]()!|_-]+")


def admin_help_manifest_path() -> Path:
    return Path(__file__).resolve().parents[2] / _MANIFEST_REL


def _load_faq_manifest() -> dict[str, Any]:
    path = admin_help_manifest_path()
    if not path.is_file():
        return {"entries": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _plain_excerpt(md: str, max_len: int = 280) -> str:
    text = _MD_NOISE.sub(" ", md)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def _doc_excerpt(settings: Settings, rel_path: str) -> str:
    try:
        return _plain_excerpt(_read_md_file(settings, rel_path), 400)
    except (FileNotFoundError, OSError, ValueError):
        return ""


def _help_tab_index(settings: Settings) -> list[dict[str, Any]]:
    """help manifest の各タブ本文を検索用にキャッシュ。"""
    rows: list[dict[str, Any]] = []
    for tab in list_help_tabs(settings):
        tab_id = tab["id"]
        try:
            from app.services.help_catalog import get_help_content

            content = get_help_content(tab_id, settings)
            md_path = ""
            manifest = json.loads(settings.help_manifest_path.read_text(encoding="utf-8"))
            entry = next((t for t in manifest.get("tabs") or [] if t.get("id") == tab_id), None)
            if entry:
                md_path = (entry.get("source") or {}).get("path") or ""
            rows.append(
                {
                    "kind": "help_tab",
                    "id": f"help:{tab_id}",
                    "title": content.get("title") or tab_id,
                    "helpTab": tab_id,
                    "category": tab.get("category") or "",
                    "searchText": _plain_excerpt(
                        _read_md_file(settings, md_path) if md_path else "",
                        8000,
                    ),
                    "excerpt": _plain_excerpt(
                        _read_md_file(settings, md_path) if md_path else "",
                        220,
                    ),
                }
            )
        except (KeyError, FileNotFoundError, ValueError, json.JSONDecodeError):
            continue
    return rows


def _faq_rows(settings: Settings) -> list[dict[str, Any]]:
    data = _load_faq_manifest()
    rows: list[dict[str, Any]] = []
    for entry in data.get("entries") or []:
        doc_bits: list[str] = []
        for rel in entry.get("docPaths") or []:
            ex = _doc_excerpt(settings, rel)
            if ex:
                doc_bits.append(ex)
        for tab_id in entry.get("helpTabs") or []:
            try:
                manifest = json.loads(settings.help_manifest_path.read_text(encoding="utf-8"))
                tab = next((t for t in manifest.get("tabs") or [] if t.get("id") == tab_id), None)
                if tab:
                    path = (tab.get("source") or {}).get("path") or ""
                    if path:
                        doc_bits.append(_doc_excerpt(settings, path))
            except (json.JSONDecodeError, OSError):
                pass

        keywords = entry.get("keywords") or []
        steps = entry.get("steps") or []
        env_vars = entry.get("envVars") or []
        search_text = " ".join(
            [
                entry.get("title") or "",
                entry.get("summary") or "",
                " ".join(keywords),
                " ".join(steps),
                " ".join(env_vars),
                " ".join(doc_bits),
            ]
        )
        rows.append(
            {
                "kind": "faq",
                "id": entry.get("id") or "",
                "title": entry.get("title") or "",
                "summary": entry.get("summary") or "",
                "steps": steps,
                "helpTabs": list(entry.get("helpTabs") or []),
                "adminLinks": list(entry.get("adminLinks") or []),
                "envVars": env_vars,
                "searchText": search_text,
                "excerpt": entry.get("summary") or "",
            }
        )
    return rows


def _tokenize_query(query: str) -> list[str]:
    q = (query or "").strip().lower()
    if not q:
        return []
    return [t for t in _TOKEN_SPLIT.split(q) if t]


def _score_row(row: dict[str, Any], tokens: list[str]) -> int:
    if not tokens:
        return 1
    hay = (row.get("searchText") or "").lower()
    title = (row.get("title") or "").lower()
    score = 0
    for tok in tokens:
        if tok in title:
            score += 12
        if tok in hay:
            score += 4
        elif any(tok in part for part in hay.split()):
            score += 2
    return score


def search_admin_help(query: str = "", *, limit: int = 20, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    tokens = _tokenize_query(query)
    rows = _faq_rows(settings) + _help_tab_index(settings)

    scored: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        score = _score_row(row, tokens)
        if not tokens or score > 0:
            scored.append((score, row))

    scored.sort(key=lambda x: (-x[0], x[1].get("title") or ""))
    items: list[dict[str, Any]] = []
    for score, row in scored[: max(1, min(limit, 50))]:
        item = {
            "id": row.get("id"),
            "kind": row.get("kind"),
            "title": row.get("title"),
            "score": score,
            "excerpt": row.get("excerpt") or row.get("summary") or "",
        }
        if row.get("kind") == "faq":
            item.update(
                {
                    "summary": row.get("summary") or "",
                    "steps": row.get("steps") or [],
                    "helpTabs": row.get("helpTabs") or [],
                    "adminLinks": row.get("adminLinks") or [],
                    "envVars": row.get("envVars") or [],
                }
            )
        else:
            item["helpTab"] = row.get("helpTab")
            item["category"] = row.get("category") or ""
        items.append(item)

    return {
        "query": query,
        "tokens": tokens,
        "count": len(items),
        "items": items,
        "faqCount": len(_faq_rows(settings)),
        "helpTabCount": len(_help_tab_index(settings)),
    }


def list_admin_faq_ids() -> list[str]:
    return [str(e.get("id") or "") for e in _load_faq_manifest().get("entries") or [] if e.get("id")]
