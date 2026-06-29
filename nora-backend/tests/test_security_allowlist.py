from app.noraops.services.security_allowlist import DEFAULT_IP_ALLOWLIST, merge_security_allowlist


def test_merge_security_allowlist_includes_defaults_when_missing():
    doc = {"schema": "nora.rules/1", "rules": []}
    merged = merge_security_allowlist(doc)
    assert "8.8.8.8" in merged["allowlist"]["ips"]
    assert "127.0.0.1" in merged["allowlist"]["ips"]


def test_merge_security_allowlist_keeps_custom_and_adds_8888():
    doc = {
        "allowlist": {"ips": ["127.0.0.1", "10.0.0.1"], "ipv6": []},
        "rules": [],
    }
    merged = merge_security_allowlist(doc)
    ips = merged["allowlist"]["ips"]
    assert "10.0.0.1" in ips
    assert "8.8.8.8" in ips
    for default_ip in DEFAULT_IP_ALLOWLIST:
        assert default_ip in ips
