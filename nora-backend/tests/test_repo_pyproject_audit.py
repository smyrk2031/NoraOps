from app.services.package_deps_audit import audit_local_repo_pyproject


def test_audit_local_repo_pyproject(tmp_path) -> None:
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / "pyproject.toml").write_text(
        '[project]\nname="d"\nrequires-python=">=3.11"\ndependencies=["unknown-pkg-xyz"]\n',
        encoding="utf-8",
    )
    out = audit_local_repo_pyproject(tmp_path)
    assert out["ok"] is True
    assert out["pyprojectRel"] == "backend/pyproject.toml"
    assert out["requiresPython"] == ">=3.11"
    assert "unknown-pkg-xyz" in out["dependencies"]
