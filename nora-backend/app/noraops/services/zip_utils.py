"""Safe zip pack/unpack for NoraOps workspace and artifact distribution."""

from __future__ import annotations

import io
import os
import zipfile
from pathlib import Path

# Paths excluded from workspace/artifact zips
DEFAULT_EXCLUDE_DIR_NAMES = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "node_modules",
    ".nora",
}
DEFAULT_EXCLUDE_FILE_NAMES = {".env", ".env.local", ".env.production"}
DEFAULT_EXCLUDE_SUFFIXES = (".pem", ".key", ".p12")


def _should_exclude(rel_posix: str, *, is_dir: bool) -> bool:
    parts = rel_posix.replace("\\", "/").split("/")
    for part in parts:
        if part in DEFAULT_EXCLUDE_DIR_NAMES:
            return True
    base = parts[-1] if parts else rel_posix
    if base in DEFAULT_EXCLUDE_FILE_NAMES:
        return True
    if not is_dir and any(base.endswith(s) for s in DEFAULT_EXCLUDE_SUFFIXES):
        return True
    if not is_dir and base.startswith(".env."):
        return True
    return False


def zip_directory(source_dir: Path, dest_zip: Path) -> int:
    """Create a zip from source_dir; returns file count."""
    source_dir = source_dir.resolve()
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = [d for d in dirs if not _should_exclude(
                str(Path(root, d).relative_to(source_dir).as_posix()), is_dir=True
            )]
            for name in files:
                full = Path(root, name)
                rel = full.relative_to(source_dir).as_posix()
                if _should_exclude(rel, is_dir=False):
                    continue
                zf.write(full, rel)
                count += 1
    return count


def safe_extract_zip(
    zip_data: bytes,
    dest_dir: Path,
    *,
    max_bytes: int,
    max_files: int = 5000,
    max_path_depth: int = 20,
) -> dict:
    """
    Extract zip safely (Zip Slip protection). Returns stats dict.
    Raises ValueError on policy violation.
    """
    if len(zip_data) > max_bytes:
        raise ValueError(f"Zip exceeds max size ({max_bytes} bytes).")

    dest_dir = dest_dir.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_count = 0

    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            if name.startswith("/") or ".." in Path(name).parts:
                raise ValueError(f"Unsafe zip path: {info.filename}")
            if len(Path(name).parts) > max_path_depth:
                raise ValueError(f"Path too deep: {info.filename}")
            if _should_exclude(name, is_dir=False):
                continue
            target = (dest_dir / name).resolve()
            if not str(target).startswith(str(dest_dir)):
                raise ValueError(f"Zip slip blocked: {info.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                out.write(src.read())
            file_count += 1
            if file_count > max_files:
                raise ValueError(f"Too many files in zip (max {max_files}).")

    if file_count == 0:
        raise ValueError("Zip contains no files after exclusions.")

    return {"files": file_count, "dest": str(dest_dir)}


def scan_forbidden_secrets(root: Path) -> list[str]:
    """Return list of relative paths that look like secrets."""
    found: list[str] = []
    root = root.resolve()
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        base = path.name
        if base in DEFAULT_EXCLUDE_FILE_NAMES or base.startswith(".env."):
            found.append(rel)
        elif any(base.endswith(s) for s in DEFAULT_EXCLUDE_SUFFIXES):
            found.append(rel)
    return found
