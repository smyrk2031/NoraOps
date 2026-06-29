"""Invoke vscode-extension repo-audit-cli.js (same engine as checkRunner)."""

from __future__ import annotations

import json
import logging
import subprocess
import tempfile
from pathlib import Path

from app.core.config import Settings
from app.noraops.services.node_runtime import NodeRuntimeError, ensure_node_runtime
from app.noraops.services.rules_loader import load_rules_bundle

logger = logging.getLogger(__name__)


class RepoAuditRunnerError(Exception):
    pass


def _cli_script(settings: Settings) -> Path:
    ext = settings.extension_abs_dir
    script = ext / "scripts" / "repo-audit-cli.js"
    if not script.is_file():
        raise RepoAuditRunnerError(
            f"repo-audit-cli.js not found at {script}. Set NORAOPS_EXTENSION_DIR to vscode-extension."
        )
    return script


def run_repo_audit(workspace: Path, settings: Settings) -> dict:
    """Run Node CLI against extracted workspace; returns parsed JSON payload."""
    workspace = workspace.resolve()
    if not workspace.is_dir():
        raise RepoAuditRunnerError(f"Workspace not found: {workspace}")

    bundle = load_rules_bundle()
    script = _cli_script(settings)
    try:
        node = ensure_node_runtime(settings)
    except NodeRuntimeError as e:
        raise RepoAuditRunnerError(str(e)) from e

    rules_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".rules.json",
            delete=False,
        ) as f:
            json.dump(bundle, f, ensure_ascii=False)
            rules_path = f.name

        proc = subprocess.run(
            [str(node), str(script), "--workspace", str(workspace), "--rules", rules_path],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(settings.extension_abs_dir),
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            raise RepoAuditRunnerError(f"repo-audit-cli failed ({proc.returncode}): {err[:500]}")

        try:
            return json.loads(proc.stdout or "{}")
        except json.JSONDecodeError as e:
            raise RepoAuditRunnerError(f"Invalid CLI JSON: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise RepoAuditRunnerError("repo-audit-cli timed out") from e
    finally:
        if rules_path:
            try:
                Path(rules_path).unlink(missing_ok=True)
            except OSError:
                logger.debug("Could not remove temp rules file %s", rules_path)
