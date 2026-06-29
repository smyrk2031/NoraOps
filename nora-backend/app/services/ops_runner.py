"""運用センター: スモーク診断 + pytest 実行。"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.noraops.services.diagnostics import run_server_diagnostics


async def run_full_ops_check(db: Session, settings: Settings) -> dict[str, Any]:
    diag = await run_server_diagnostics(db, settings)
    pytest_result = await asyncio.to_thread(_run_pytest, settings)
    return {
        "diagnostics": diag,
        "pytest": pytest_result,
        "ok": bool(diag.get("ok")) and bool(pytest_result.get("ok")),
    }


def _run_pytest(settings: Settings) -> dict[str, Any]:
    server_root = Path(__file__).resolve().parents[2]
    tests_dir = server_root / "tests"
    if not tests_dir.is_dir():
        return {"ok": True, "skipped": True, "detail": "tests/ がありません", "output": ""}
    import subprocess

    cmd = [sys.executable, "-m", "pytest", "tests", "-q", "--tb=short"]

    try:
        completed = subprocess.run(
            cmd,
            cwd=str(server_root),
            capture_output=True,
            text=True,
            timeout=120,
            encoding="utf-8",
            errors="replace",
        )
        out = (completed.stdout or "") + (completed.stderr or "")
        return {
            "ok": completed.returncode == 0,
            "exitCode": completed.returncode,
            "output": out[-12000:],
            "command": " ".join(cmd),
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "exitCode": -1, "output": "pytest timeout (120s)", "command": " ".join(cmd)}
    except Exception as e:
        return {"ok": False, "exitCode": -1, "output": str(e), "command": " ".join(cmd)}
