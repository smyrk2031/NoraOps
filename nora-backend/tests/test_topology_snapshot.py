"""topology_snapshot サービスのテスト。"""

from app.services.topology_snapshot import build_topology_snapshot


class _FakeSession:
    pass


class _FakeSettings:
    env = "dev"
    db_backend = "sqlite"
    noraops_auth_mode = "open"
    noraops_gitea_auto_provision = True
    noraops_require_email_activation = True
    gitea_base_url = "http://gitea.example"
    gitea_list_mode = "scoped"
    gitea_orgs = ["org1"]
    noraops_published_topic = "nora-published"
    noraops_catalog_dev_show_all = False
    noraops_pypi_index_url = ""
    noraops_pypi_fallback_enabled = True
    noraops_ai_enabled = False
    azure_openai_endpoint = ""
    azure_openai_api_key = ""
    noraops_copilot_enabled = True
    noraops_continue_enabled = True
    noraops_repo_audit_enabled = True
    noraops_repo_audit_on_save = True
    noraops_backup_enabled = True
    noraops_public_base_url = ""
    noraops_root_path = ""
    client_download_url = "http://example/vsix"
    tools_manifest_path = "./data/tools/manifest.json"

    @property
    def expose_gitea_token_to_client(self):
        return False


def test_topology_snapshot_no_secrets(monkeypatch):
    class _Cfg:
        gitea_base_url = "http://gitea.example"
        gitea_token = "gitea_pat_" + "x" * 40
        gitea_orgs = ["org1"]

    monkeypatch.setattr(
        "app.services.topology_snapshot.AdminConfigService",
        lambda db: type("S", (), {"resolve_runtime_config": lambda self, s: _Cfg()})(),
    )
    monkeypatch.setattr(
        "app.services.topology_snapshot.pypi_runtime_fields",
        lambda s, r=None: {"pypiIndexUrl": "", "pypiFallbackEnabled": True, "packageAllowlistCount": 0, "packageAllowlistEtag": "abc"},
    )

    snap = build_topology_snapshot(_FakeSession(), _FakeSettings(), request=None)
    assert "gitea_pat" not in str(snap)
    assert snap["auth"]["mode"] == "open"
    assert "features" in snap
    assert snap["gitea"]["tokenConfigured"] is True
    assert snap["pypi"]["status"] == "off"
