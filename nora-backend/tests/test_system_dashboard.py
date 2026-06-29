from app.services.system_dashboard import format_bytes


def test_format_bytes():
    assert format_bytes(500) == "500 B"
    assert format_bytes(2048) == "2.0 KB"
    assert format_bytes(1024 * 1024 * 5) == "5.0 MB"
