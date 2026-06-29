"""Tests for catalog artifact meta (versions.json / latest.json)."""

import json
from pathlib import Path

import pytest

from app.core.config import Settings
from app.noraops.services import catalog_meta


@pytest.fixture
def artifacts_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(catalog_meta, "_artifacts_root", lambda _settings=None: tmp_path)
    return tmp_path


def test_read_artifact_meta_prefers_versions_json(artifacts_root: Path) -> None:
    base = artifacts_root / "alice" / "demo"
    base.mkdir(parents=True)
    (base / "versions.json").write_text(
        json.dumps(
            {
                "latestTag": "v1.2.0",
                "latestSha": "sha-versions",
                "versions": {
                    "v1.2.0": {"branch": "main", "builtAt": "2026-06-21T12:00:00Z"},
                },
            }
        ),
        encoding="utf-8",
    )
    (base / "latest.json").write_text(
        json.dumps({"sha": "sha-legacy", "branch": "main"}),
        encoding="utf-8",
    )
    settings = Settings()
    meta = catalog_meta.read_artifact_meta(settings, "alice", "demo")
    assert meta["sha"] == "sha-versions"
    assert meta["tag"] == "v1.2.0"
    assert meta["builtAt"] == "2026-06-21T12:00:00Z"


def test_read_artifact_meta_falls_back_to_latest_json(artifacts_root: Path) -> None:
    base = artifacts_root / "bob" / "app"
    base.mkdir(parents=True)
    (base / "latest.json").write_text(
        json.dumps({"sha": "sha-only", "branch": "develop", "builtAt": "2026-01-01T00:00:00Z"}),
        encoding="utf-8",
    )
    settings = Settings()
    meta = catalog_meta.read_artifact_meta(settings, "bob", "app")
    assert meta["sha"] == "sha-only"
    assert meta["branch"] == "develop"
