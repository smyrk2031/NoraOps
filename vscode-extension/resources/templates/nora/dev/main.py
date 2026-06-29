"""{{displayName}} — NoraOps アプリ（nora/dev/main.py）."""

from __future__ import annotations

import sys
from pathlib import Path

DEV_ROOT = Path(__file__).resolve().parent
LOG_PATH = DEV_ROOT / "logs" / "log.txt"
MEDIA_DIR = DEV_ROOT / "media"
STATIC_DIR = DEV_ROOT / "static"


def main() -> None:
    print("NoraOps: nora/dev/main.py")
    print("AI が生成したコードでこのファイルを置き換えてください。")
    print(f"ログ: {LOG_PATH}")


if __name__ == "__main__":
    main()
