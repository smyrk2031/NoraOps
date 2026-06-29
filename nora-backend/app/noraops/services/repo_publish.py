"""Publish repo to Runner catalog (topic + version tag + artifact)."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.noraops.services.artifact_builder import ArtifactBuilder
from app.noraops.services.published_version_service import (
    record_published_version,
    validate_version_bump,
    version_to_tag,
)
from app.services.admin_config_service import RuntimeIntegrationConfig
from app.services.gitea_client import GiteaClient, GiteaClientError

logger = logging.getLogger(__name__)


class RepoPublishService:
    def __init__(self, client: GiteaClient, cfg: RuntimeIntegrationConfig, settings: Settings) -> None:
        self._client = client
        self._cfg = cfg
        self._settings = settings

    async def ensure_topic(self, owner: str, name: str) -> list[str]:
        topic = self._settings.noraops_published_topic
        repo = await self._client.get_repo(owner, name)
        if not repo:
            raise GiteaClientError(f"Repository {owner}/{name} not found.")
        existing = repo.get("topics") or []
        if not isinstance(existing, list):
            existing = []
        merged = list(dict.fromkeys([*existing, topic]))
        if topic not in existing:
            await self._client.set_repo_topics(owner, name, merged)
        return merged

    async def publish_version(
        self,
        db: Session,
        owner: str,
        name: str,
        *,
        version: str,
        commit_sha: str,
        publisher_email: str = "",
        publisher_login: str = "",
        latest_version: str | None = None,
    ) -> dict[str, Any]:
        normalized = validate_version_bump(version, latest_version)
        tag = version_to_tag(normalized)

        topics = await self.ensure_topic(owner, name)

        builder = ArtifactBuilder(self._cfg, self._settings)
        try:
            artifact = await builder.build(owner, name, tag=tag)
        except GiteaClientError as e:
            logger.warning("artifact build failed for %s/%s@%s: %s", owner, name, tag, e)
            raise

        row = record_published_version(
            db,
            owner=owner,
            name=name,
            version=normalized,
            tag=tag,
            commit_sha=commit_sha or str(artifact.get("sha") or ""),
            published_by_email=publisher_email,
            published_by_login=publisher_login,
        )

        return {
            "ok": True,
            "full_name": f"{owner}/{name}",
            "version": normalized,
            "tag": tag,
            "commitSha": row.commit_sha,
            "topics": topics,
            "publishedTopic": self._settings.noraops_published_topic,
            "publisherEmail": row.published_by_email or "",
            "publisherLogin": row.published_by_login or "",
            "artifact": {
                "cached": artifact.get("cached"),
                "sha": artifact.get("sha"),
            },
        }

    async def publish(self, owner: str, name: str) -> dict[str, Any]:
        """Legacy: topic only + latest main artifact (no version record)."""
        topics = await self.ensure_topic(owner, name)
        builder = ArtifactBuilder(self._cfg, self._settings)
        artifact = await builder.build(owner, name)
        return {
            "ok": True,
            "full_name": f"{owner}/{name}",
            "topics": topics,
            "publishedTopic": self._settings.noraops_published_topic,
            "artifactBuild": "done",
            "sha": artifact.get("sha"),
        }
