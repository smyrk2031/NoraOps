"""Unit tests for repo save worktree sync."""

from __future__ import annotations

import subprocess
from pathlib import Path

from app.noraops.services.repo_save import _sync_worktree_from_extract


def test_sync_worktree_replaces_tracked_files_keeps_git(tmp_path: Path) -> None:
    repo_dir = tmp_path / "repo"
    extract_dir = tmp_path / "extract"
    repo_dir.mkdir()
    extract_dir.mkdir()

    subprocess.run(["git", "init"], cwd=repo_dir, check=True)
    (repo_dir / "old.txt").write_text("old", encoding="utf-8")
    subprocess.run(["git", "add", "old.txt"], cwd=repo_dir, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_dir, check=True)

    (extract_dir / "new.txt").write_text("new", encoding="utf-8")
    (extract_dir / "nested").mkdir()
    (extract_dir / "nested" / "a.py").write_text("print(1)", encoding="utf-8")

    _sync_worktree_from_extract(repo_dir, extract_dir)

    assert (repo_dir / ".git").is_dir()
    assert not (repo_dir / "old.txt").exists()
    assert (repo_dir / "new.txt").read_text(encoding="utf-8") == "new"
    assert (repo_dir / "nested" / "a.py").is_file()
