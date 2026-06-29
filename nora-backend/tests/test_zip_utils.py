"""Unit tests for safe zip handling."""

from __future__ import annotations

import io
import zipfile

import pytest

from app.noraops.services.zip_utils import safe_extract_zip, scan_forbidden_secrets


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_safe_extract_rejects_parent_path(tmp_path):
    data = _zip_bytes({"../evil.txt": b"x"})
    with pytest.raises(ValueError, match="Unsafe"):
        safe_extract_zip(data, tmp_path / "out", max_bytes=1_000_000)


def test_scan_forbidden_env(tmp_path):
    (tmp_path / ".env").write_text("SECRET=1", encoding="utf-8")
    found = scan_forbidden_secrets(tmp_path)
    assert ".env" in found
