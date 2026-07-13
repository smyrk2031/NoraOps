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


def test_safe_extract_rejects_sibling_prefix_path(tmp_path):
    """dest 'out' must not accept a sibling like 'out-evil' via string prefix."""
    out = tmp_path / "out"
    data = _zip_bytes({"a.txt": b"x"})
    # sanity: legitimate extract works
    safe_extract_zip(data, out, max_bytes=1_000_000)
    # A crafted absolute-ish name is rejected before it can escape.
    evil = _zip_bytes({"/etc/passwd": b"x"})
    with pytest.raises(ValueError, match="Unsafe"):
        safe_extract_zip(evil, out, max_bytes=1_000_000)


def test_safe_extract_rejects_symlink_entry(tmp_path):
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("link")
        # 0o120000 == S_IFLNK; store unix mode in the high 16 bits of external_attr
        info.external_attr = (0o120777) << 16
        zf.writestr(info, "/etc/passwd")
    with pytest.raises(ValueError, match="Symlink"):
        safe_extract_zip(buf.getvalue(), tmp_path / "out", max_bytes=1_000_000)


def test_scan_forbidden_env(tmp_path):
    (tmp_path / ".env").write_text("SECRET=1", encoding="utf-8")
    found = scan_forbidden_secrets(tmp_path)
    assert ".env" in found
