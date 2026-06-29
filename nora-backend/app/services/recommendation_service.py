"""Very small rule-based recommender placeholder for future embeddings."""

from __future__ import annotations

import json
from typing import Any


class RecommendationService:
    def rank(self, items: list[dict[str, Any]], query: str, limit: int = 25) -> list[dict[str, Any]]:
        if not query.strip():
            return items[:limit]

        ql = query.lower().split()
        scored: list[tuple[float, dict[str, Any]]] = []
        for repo in items:
            blob = json.dumps(repo, ensure_ascii=False).lower()
            score = sum(1 for t in ql if t and t in blob)
            if score:
                scored.append((float(score), repo))
        scored.sort(key=lambda x: (-x[0], -x[1]["stars"]))
        return [r for _, r in scored[:limit]]
