"""Published catalog filter for Runner / Tauri (Phase1b thin)."""

from __future__ import annotations

from typing import Any

DEFAULT_PUBLISHED_TOPIC = "nora-published"


class PublishedCatalogService:
    def filter_items(
        self,
        items: list[dict[str, Any]],
        *,
        topic: str = DEFAULT_PUBLISHED_TOPIC,
        query: str = "",
        dev_show_all: bool = False,
    ) -> tuple[list[dict[str, Any]], bool]:
        """Return (items, used_dev_fallback)."""
        published = []
        for item in items:
            topics = item.get("topics") or []
            if not isinstance(topics, list):
                topics = []
            if topic in topics:
                published.append({**item, "published": True})

        if published:
            return self._apply_query(published, query), False

        if dev_show_all:
            tagged = [{**item, "published": False, "_dev_unpublished": True} for item in items]
            return self._apply_query(tagged, query), True

        return [], False

    def _apply_query(self, items: list[dict[str, Any]], query: str) -> list[dict[str, Any]]:
        q = (query or "").strip().lower()
        if not q:
            return items
        out = []
        for item in items:
            hay = " ".join(
                [
                    str(item.get("full_name") or ""),
                    str(item.get("name") or ""),
                    str(item.get("description") or ""),
                    " ".join(item.get("topics") or []),
                ]
            ).lower()
            if q in hay:
                out.append(item)
        return out

    def filter_by_full_names(
        self,
        items: list[dict[str, Any]],
        allowed_full_names: set[str],
    ) -> list[dict[str, Any]]:
        if not allowed_full_names:
            return []
        out = []
        for item in items:
            full = str(item.get("full_name") or "").strip().lower()
            if not full:
                owner = item.get("owner")
                login = owner.get("login", "") if isinstance(owner, dict) else str(owner or "")
                name = str(item.get("name") or "")
                full = f"{login}/{name}".strip("/").lower()
            if full and full in allowed_full_names:
                out.append(item)
        return out
