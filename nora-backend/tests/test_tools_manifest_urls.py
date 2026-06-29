from app.services.tools_manifest_urls import rewrite_tool_download_urls


def test_rewrite_tool_download_urls_replaces_origin():
    manifest = {
        "uv": {"url": "http://127.0.0.1:8000/api/tools/files/uv/0.6.0/uv.exe"},
        "portableGit": {
            "url": "http://127.0.0.1:8000/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe"
        },
    }
    out = rewrite_tool_download_urls(manifest, "https://intra.example.local/NoraOps")
    assert out["uv"]["url"] == "https://intra.example.local/NoraOps/api/tools/files/uv/0.6.0/uv.exe"
    assert (
        out["portableGit"]["url"]
        == "https://intra.example.local/NoraOps/api/tools/files/git/2.54.0/PortableGit-2.54.0-64-bit.7z.exe"
    )


def test_rewrite_tool_download_urls_keeps_when_base_empty():
    manifest = {"uv": {"url": "http://127.0.0.1:8000/api/tools/files/uv/0.6.0/uv.exe"}}
    out = rewrite_tool_download_urls(manifest, "")
    assert out["uv"]["url"] == manifest["uv"]["url"]
