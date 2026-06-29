"""認証 identity 解析とデバイストークン。"""

from unittest.mock import MagicMock

from app.core.config import Settings
from app.noraops.auth.device_store import get_device_store
from app.noraops.auth.identity import parse_identity_from_request
from app.noraops.auth.user_deps import (
    get_request_identity,
    resolve_identity_from_device_token,
)


def _request(headers: dict | None = None):
    req = MagicMock()
    req.headers = headers or {}
    req.state = MagicMock()
    req.state.noraops_identity = None
    return req


def test_parse_domain_backslash_user():
    settings = Settings(NORAOPS_TRUSTED_USER_HEADER="X-Remote-User")
    req = _request({"X-Remote-User": "CORP\\yamada"})
    ident = parse_identity_from_request(req, settings)
    assert ident is not None
    assert ident.external_id == "CORP\\yamada"
    assert ident.username == "yamada"
    assert ident.gitea_login_candidate == "yamada"


def test_device_token_resolves_identity():
    store = get_device_store()
    code = store.issue_code("CORP\\tester")
    token = store.exchange_code(code)
    assert token
    ident = resolve_identity_from_device_token(token)
    assert ident is not None
    assert ident.external_id == "CORP\\tester"


def test_get_request_identity_from_device_header():
    store = get_device_store()
    token = store.exchange_code(store.issue_code("DEV\\extuser"))
    req = _request({"X-NoraOps-Device-Token": token})
    ident = get_request_identity(req)
    assert ident is not None
    assert ident.external_id == "DEV\\extuser"
