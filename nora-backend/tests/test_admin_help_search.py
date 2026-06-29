"""Tests for admin help search."""

from app.services.admin_help_search import list_admin_faq_ids, search_admin_help


def test_list_admin_faq_ids():
    ids = list_admin_faq_ids()
    assert "client-backend-connection" in ids
    assert "gitea-user-password" in ids


def test_search_admin_help_connection():
    result = search_admin_help("接続 baseUrl")
    assert result["count"] >= 1
    titles = [i["title"] for i in result["items"]]
    assert any("つながらない" in t for t in titles)


def test_search_admin_help_gitea_password():
    result = search_admin_help("Gitea パスワード")
    assert result["count"] >= 1
    faq = next(i for i in result["items"] if i.get("kind") == "faq" and "Gitea" in i.get("title", ""))
    assert faq.get("steps")
    assert "GITEA_TOKEN" in (faq.get("envVars") or [])


def test_search_empty_returns_items():
    result = search_admin_help("")
    assert result["count"] >= len(list_admin_faq_ids())
