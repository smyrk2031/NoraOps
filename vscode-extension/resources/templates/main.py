"""{{displayName}} — NoraOps アプリ（main.py）."""

from __future__ import annotations

import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
LOG_PATH = APP_ROOT / "logs" / "log.txt"
MEDIA_DIR = APP_ROOT / "media"
STATIC_DIR = APP_ROOT / "static"


def main() -> None:
    print("NoraOps: main.py")
    print("AI が生成したコードでこのファイルを置き換えてください。")
    print(f"ログ: {LOG_PATH}")


if __name__ == "__main__":
    main()
