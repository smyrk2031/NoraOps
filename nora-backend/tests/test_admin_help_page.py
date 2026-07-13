"""Admin help page renders without Jinja dict.items collision."""

from fastapi.testclient import TestClient

from app.main import app


def test_admin_help_page_renders():
    client = TestClient(app)
    response = client.get("/admin/help")
    assert response.status_code == 200
    assert "運用 Q&A" in response.text
    assert "拡張とバックエンドがつながらない" in response.text


def test_admin_help_search_query():
    client = TestClient(app)
    response = client.get("/admin/help?q=Runner")
    assert response.status_code == 200
    assert "Runner" in response.text
