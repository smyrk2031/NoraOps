#!/usr/bin/env python3
"""CLI: sync allowlisted packages from PyPI into the local mirror directory."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.services.pypi_mirror_sync import run_mirror_sync  # noqa: E402


def main() -> int:
    result = run_mirror_sync()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result.get("failures") else 0


if __name__ == "__main__":
    raise SystemExit(main())
