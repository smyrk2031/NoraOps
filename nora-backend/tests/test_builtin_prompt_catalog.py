"""基本プロンプトカタログ API / CMS 検証。"""

import json

import pytest

from app.noraops.services import builtin_prompt_catalog as bpc


def test_load_builtin_catalog_has_prompts():
    catalog, ver = bpc.load_builtin_catalog()
    assert ver == "0.21.1"
    assert isinstance(catalog.get("prompts"), list)
    assert len(catalog["prompts"]) >= 14
    keys = {p["key"] for p in catalog["prompts"]}
    assert "xllm.general" in keys
    assert "xllm.docs.portal" in keys
    assert "xllm.docs.spec-html" in keys


def test_validate_catalog_rejects_duplicate_keys():
    data = {
        "version": "0.21.2",
        "prompts": [
            {"key": "xllm.a", "title": "A", "category": "xllm"},
            {"key": "xllm.a", "title": "B", "category": "xllm"},
        ],
    }
    with pytest.raises(ValueError, match="重複"):
        bpc.validate_catalog(data)


def test_validate_catalog_normalizes_dynamic_body(tmp_path, monkeypatch):
    monkeypatch.setattr(bpc, "catalog_path", lambda: tmp_path / "builtin-catalog.json")
    data = {
        "version": "1.0.0",
        "prompts": [
            {
                "key": "xllm.test",
                "title": "Test",
                "category": "xllm",
                "dynamic": True,
                "body": "ignored",
                "order": 5,
            },
            {
                "key": "creator.note",
                "title": "Note",
                "category": "creator",
                "body": "hello",
                "order": 1,
            },
        ],
    }
    normalized = bpc.validate_catalog(data)
    assert normalized["prompts"][0]["key"] == "creator.note"
    assert normalized["prompts"][1]["key"] == "xllm.test"
    assert normalized["prompts"][1]["body"] is None

    ver = bpc.validate_and_write_catalog(data)
    assert ver == "1.0.0"
    saved = json.loads((tmp_path / "builtin-catalog.json").read_text(encoding="utf-8"))
    assert len(saved["prompts"]) == 2


def test_validate_catalog_rejects_bad_key():
    data = {"version": "1.0.0", "prompts": [{"key": "BAD", "title": "x", "category": "xllm"}]}
    with pytest.raises(ValueError, match="key"):
        bpc.validate_catalog(data)
