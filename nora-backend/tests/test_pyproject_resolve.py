from pathlib import Path

from app.noraops.services.pyproject_resolve import (
    discover_pyproject_candidates,
    parse_pyproject_summary,
    resolve_pyproject,
)


def test_prefers_root_over_legacy(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text("[project]\nname='root'\n", encoding="utf-8")
    legacy = tmp_path / "nora" / "packages"
    legacy.mkdir(parents=True)
    (legacy / "pyproject.toml").write_text("[project]\nname='legacy'\n", encoding="utf-8")
    res = resolve_pyproject(tmp_path, manifest=None)
    assert res.ok
    assert res.source == "root"


def test_manifest_packages_project_wins(tmp_path: Path) -> None:
    man = tmp_path / "nora"
    man.mkdir()
    (man / "manifest.json").write_text(
        '{"packagesProject":"backend","appId":"nora.app.x"}',
        encoding="utf-8",
    )
    (tmp_path / "pyproject.toml").write_text("[project]\nname='root'\n", encoding="utf-8")
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / "pyproject.toml").write_text("[project]\nname='backend'\n", encoding="utf-8")
    res = resolve_pyproject(tmp_path)
    assert res.source == "manifest"
    assert res.pyproject_rel == "backend/pyproject.toml"


def test_shallow_backend_only(tmp_path: Path) -> None:
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / "pyproject.toml").write_text("[project]\nname='b'\n", encoding="utf-8")
    res = resolve_pyproject(tmp_path, manifest=None)
    assert res.ok
    assert res.source == "shallow"


def test_parse_pyproject_summary_file(tmp_path: Path) -> None:
    py = tmp_path / "pyproject.toml"
    py.write_text(
        '[project]\nname="d"\nrequires-python=">=3.11"\ndependencies=["numpy==1.26.0"]\n',
        encoding="utf-8",
    )
    summary = parse_pyproject_summary(py)
    assert summary["requiresPython"] == ">=3.11"
    assert summary["dependencies"] == ["numpy"]


def test_discover_prefers_app_subdir(tmp_path: Path) -> None:
    app = tmp_path / "app"
    zed = tmp_path / "z-other"
    app.mkdir()
    zed.mkdir()
    (app / "pyproject.toml").write_text("[project]\nname='a'\n", encoding="utf-8")
    (zed / "pyproject.toml").write_text("[project]\nname='z'\n", encoding="utf-8")
    cands = discover_pyproject_candidates(tmp_path, manifest=None)
    shallow = [c for c in cands if c.source == "shallow"]
    assert shallow[0].dir_rel == "app"
