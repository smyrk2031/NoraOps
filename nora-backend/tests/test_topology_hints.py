"""topology_hints のテスト。"""

from app.services.topology_hints import action_items, build_topology_hints


class _Settings:
    noraops_smtp_host = ""
    noraops_mail_http_url = ""


def _snap_gitea_off():
    return {
        "gitea": {"status": "off", "baseUrl": "", "tokenConfigured": False, "tokenIssue": ""},
        "pypi": {"status": "off", "allowlistCount": 0},
        "ai": {"status": "off", "enabled": False, "configured": False},
        "auth": {"mode": "open", "label": "open", "giteaAutoProvision": True},
        "deployment": {"env": "dev", "rootPath": "/"},
    }


def test_build_hints_gitea_warn():
    hints = build_topology_hints(_snap_gitea_off(), _Settings())
    g = next(h for h in hints if h["id"] == "gitea")
    assert g["severity"] == "warn"
    assert any("GITEA_BASE_URL" in (s.get("code") or "") for s in g["steps"])
    assert any(s.get("link") == "/admin/settings" for s in g["steps"])


def test_action_items_excludes_ok():
    hints = build_topology_hints(_snap_gitea_off(), _Settings())
    items = action_items(hints)
    assert all(i["severity"] != "ok" for i in items)
    assert any(i["id"] == "gitea" for i in items)
