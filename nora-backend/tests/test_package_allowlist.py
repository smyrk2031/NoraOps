from io import BytesIO

from openpyxl import Workbook

from app.services.package_allowlist import (
    XlsxImportConfig,
    classify_packages,
    column_letter_to_index,
    compute_allowlist_diff,
    ingest_xlsx,
    is_package_allowed,
    normalize_pkg_name,
    parse_version_for_import,
    parse_xlsx_import,
    save_allowlist,
    version_matches,
)


def test_version_wildcard_major():
    assert version_matches("2.*", "2.1.0") is True
    assert version_matches("2.*", "3.0.0") is False


def test_version_wildcard_triple():
    assert version_matches("1.*.*", "1.2.3") is True
    assert version_matches("1.*.*", "2.0.0") is False


def test_version_blank_and_dash():
    for raw in ("", "-", "—"):
        status, spec, reason = parse_version_for_import(raw)
        assert status == "allowed"
        assert spec == ""
        assert reason is None


def test_version_review_suspicious():
    status, spec, reason = parse_version_for_import("要確認")
    assert status == "review"
    assert spec == ""
    assert reason


def test_column_letter_to_index():
    assert column_letter_to_index("A") == 0
    assert column_letter_to_index("B") == 1
    assert column_letter_to_index("C") == 2
    assert column_letter_to_index("D") == 3


def _build_xlsx(rows: list[tuple], *, start_row: int = 10) -> bytes:
    wb = Workbook()
    ws = wb.active
    for i, row in enumerate(rows):
        for col_idx, value in enumerate(row, start=1):
            ws.cell(row=start_row + i, column=col_idx, value=value)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_xlsx_import_with_defaults():
    content = _build_xlsx(
        [
            ("Pythonライブラリ", "requests", "2.*"),
            ("Pythonライブラリ", "pandas", ""),
            ("その他", "flask", "3.*"),
            ("Pythonライブラリ", "numpy", "要確認"),
        ]
    )
    result = parse_xlsx_import(content, XlsxImportConfig())
    assert len(result["packages"]) == 2
    names = {p["name"] for p in result["packages"]}
    assert names == {"requests", "pandas"}
    assert result["packages"][0]["versionSpec"] == ">=2.0,<3"
    assert len(result["review"]) == 1
    assert result["review"][0]["name"] == "numpy"
    assert len(result["skipped"]) == 1


def test_parse_xlsx_import_legacy_row2():
    content = _build_xlsx(
        [("app1", "httpx", "0.27.*")],
        start_row=2,
    )
    cfg = XlsxImportConfig(
        header_row=1,
        category_col="",
        category_filter="",
        package_col="B",
        version_col="C",
        maintenance_date_col="",
    )
    result = parse_xlsx_import(content, cfg)
    assert len(result["packages"]) == 1
    assert result["packages"][0]["name"] == "httpx"


def test_compute_allowlist_diff():
    old = [
        {"name": "requests", "versionSpec": ">=2.0,<3"},
        {"name": "pandas", "versionSpec": ""},
        {"name": "flask", "versionSpec": ""},
    ]
    new = [
        {"name": "requests", "versionSpec": ">=2.28,<3"},
        {"name": "pandas", "versionSpec": ""},
        {"name": "numpy", "versionSpec": ">=1.26"},
    ]
    diff = compute_allowlist_diff(old, new)
    assert [r["name"] for r in diff["added"]] == ["numpy"]
    assert [r["name"] for r in diff["removed"]] == ["flask"]
    assert diff["changed"][0]["name"] == "requests"
    assert diff["unchangedCount"] == 1


def test_ingest_xlsx_saves_review_separately(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.package_allowlist.allowlist_path",
        lambda: tmp_path / "allowlist.json",
    )
    save_allowlist({"packages": [{"name": "httpx", "versionSpec": ""}]})
    content = _build_xlsx([("Pythonライブラリ", "django", "latest")])
    result = ingest_xlsx(content)
    data = result["allowlist"]
    assert data["packages"] == []
    assert len(data["lastImport"]["review"]) == 1
    assert data["lastImport"]["counts"]["allowed"] == 0
    assert data["lastImport"]["diff"]["removed"][0]["name"] == "httpx"


def test_is_package_allowed(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.package_allowlist.allowlist_path",
        lambda: tmp_path / "allowlist.json",
    )
    save_allowlist(
        {
            "packages": [
                {"name": "requests", "versionSpec": ">=2.28,<3"},
                {"name": "pandas", "versionSpec": ""},
            ]
        }
    )
    assert is_package_allowed("requests", "2.31.0") is True
    assert is_package_allowed("requests", "3.0.0") is False
    assert is_package_allowed("pandas", "2.0.0") is True
    assert is_package_allowed("unknown") is False


def test_classify_packages(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.package_allowlist.allowlist_path",
        lambda: tmp_path / "allowlist.json",
    )
    save_allowlist({"packages": [{"name": "numpy", "versionSpec": ""}]})
    result = classify_packages([{"name": "numpy"}, {"name": "flask"}])
    assert len(result["approved"]) == 1
    assert result["unapproved"][0]["name"] == normalize_pkg_name("flask")
