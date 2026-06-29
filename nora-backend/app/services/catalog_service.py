"""Summarize raw Gitea repo payloads for catalog clients."""

from __future__ import annotations

from typing import Any


class CatalogService:
    def build_items(self, repos: list[dict[str, Any]]) -> list[dict[str, Any]]:
        items = []
        for repo in repos:
            owner_login = ""
            raw_owner = repo.get("owner")
            if isinstance(raw_owner, dict):
                owner_login = str(raw_owner.get("login") or "")
            elif isinstance(raw_owner, str):
                owner_login = raw_owner
            full_name = str(repo.get("full_name") or "")
            name = str(repo.get("name") or "")
            if not name and "/" in full_name:
                name = full_name.split("/")[-1]
            if not owner_login and "/" in full_name:
                owner_login = full_name.split("/")[0]

            topics = repo.get("topics") or []
            topics = topics if isinstance(topics, list) else []

            items.append(
                {
                    "full_name": full_name or f"{owner_login}/{name}",
                    "name": name,
                    "stars": int(repo.get("stars_count") or 0),
                    "description": repo.get("description"),
                    "updated_at": repo.get("updated_at"),
                    "owner": {"login": owner_login},
                    "topics": topics,
                }
            )
        return sorted(items, key=lambda x: (x["stars"], x["updated_at"] or ""), reverse=True)
