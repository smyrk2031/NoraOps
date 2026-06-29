from __future__ import annotations

from collections import Counter
from typing import Any

from app.schemas.analytics import (
    AppSummary,
    KnowledgeInsight,
    PolicyViolation,
    WorkflowInsight,
)


class RepoAnalyzer:
    def app_catalog(self, repos: list[dict[str, Any]]) -> list[AppSummary]:
        apps: list[AppSummary] = []
        for repo in repos:
            topics = repo.get("topics") or []
            apps.append(
                AppSummary(
                    full_name=repo.get("full_name", ""),
                    stars=repo.get("stars_count", 0),
                    updated_at=repo.get("updated_at"),
                    has_release=bool(repo.get("has_releases", False)),
                    topics=topics,
                    readme_hint=repo.get("description"),
                )
            )
        return sorted(apps, key=lambda x: (x.stars, x.updated_at or ""), reverse=True)

    def knowledge_insights(self, repos: list[dict[str, Any]]) -> list[KnowledgeInsight]:
        topic_counter: Counter[str] = Counter()
        topic_sources: dict[str, list[str]] = {}

        for repo in repos:
            full_name = repo.get("full_name", "")
            for topic in repo.get("topics") or []:
                topic_counter[topic] += 1
                topic_sources.setdefault(topic, []).append(full_name)

        insights: list[KnowledgeInsight] = []
        for topic, count in topic_counter.most_common(5):
            insights.append(
                KnowledgeInsight(
                    title=f"Topic trend: {topic}",
                    description=f"{count} repositories contain this topic.",
                    source_repos=topic_sources.get(topic, [])[:8],
                )
            )
        return insights

    def workflow_insights(self, repos: list[dict[str, Any]]) -> list[WorkflowInsight]:
        ci_like = [r for r in repos if ".github" in (r.get("description") or "").lower()]
        release_ready = [r for r in repos if r.get("has_releases")]
        active_recent = [r for r in repos if r.get("updated_at")]

        return [
            WorkflowInsight(
                name="Release-ready repositories",
                repositories=len(release_ready),
                description="Repositories that already publish releases in Gitea.",
            ),
            WorkflowInsight(
                name="Automation signals",
                repositories=len(ci_like),
                description="Repositories hinting at CI/workflow automation in descriptions.",
            ),
            WorkflowInsight(
                name="Active maintenance",
                repositories=len(active_recent),
                description="Repositories with update timestamps that can be tracked for cadence.",
            ),
        ]

    def policy_violations(self, repos: list[dict[str, Any]]) -> list[PolicyViolation]:
        violations: list[PolicyViolation] = []
        for repo in repos:
            full_name = repo.get("full_name", "")
            default_branch = repo.get("default_branch") or ""
            has_release = bool(repo.get("has_releases", False))
            repo_name = repo.get("name", "")

            if default_branch not in {"main", "master"}:
                violations.append(
                    PolicyViolation(
                        full_name=full_name,
                        violation_type="branch_policy",
                        detail=f"default branch is '{default_branch}'",
                        severity="medium",
                    )
                )
            if not has_release:
                violations.append(
                    PolicyViolation(
                        full_name=full_name,
                        violation_type="release_policy",
                        detail="repository has no release",
                        severity="high",
                    )
                )
            if "_" in repo_name:
                violations.append(
                    PolicyViolation(
                        full_name=full_name,
                        violation_type="naming_policy",
                        detail="repository name includes underscore",
                        severity="low",
                    )
                )
        return violations
