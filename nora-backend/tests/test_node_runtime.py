from app.noraops.services.node_runtime import _parse_version, _version_compatible


def test_parse_version() -> None:
    assert _parse_version("v22.12.0") == (22, 12, 0)
    assert _parse_version("22.13.1") == (22, 13, 1)


def test_version_compatible_same_major() -> None:
    assert _version_compatible("v22.12.0", "22.12.0") is True
    assert _version_compatible("v22.13.0", "22.12.0") is True
    assert _version_compatible("v22.11.0", "22.12.0") is False
    assert _version_compatible("v23.0.0", "22.12.0") is False
