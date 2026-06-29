"""pyproject.toml 探索・優先度（サーバー側リポ走査 / 監査用）。

探索範囲と優先度は vscode-extension/src/noraops/pyprojectResolve.js と同期すること。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

PYPROJECT_FILE = "pyproject.toml"
LEGACY_PACKAGES_REL = Path("nora/packages")

SKIP_SUBDIRS = frozenset(
    {
        ".git",
        ".nora",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        "dist",
        "build",
        ".vscode",
        "static",
        "media",
        "logs",
        "assets",
    }
)

PREFERRED_SUBDIRS = ("app", "backend", "server", "src", "api", "web", "python")

PRIORITY_MANIFEST = 0
PRIORITY_ROOT = 10
PRIORITY_LEGACY = 20
PRIORITY_SHALLOW_BASE = 30


@dataclass(frozen=True)
class PyprojectCandidate:
    dir_rel: str
    pyproject_rel: str
    source: str
    priority: int


@dataclass(frozen=True)
class PyprojectResolution:
    ok: bool
    app_root: Path
    project_dir: Path
    pyproject_path: Path
    pyproject_rel: str
    source: str | None
    candidates: tuple[PyprojectCandidate, ...]
    ambiguous: bool
    alternate_rels: tuple[str, ...]


def _normalize_rel_posix(rel: str | None) -> str:
    if not rel or rel in (".", "./"):
        return "."
    return str(rel).replace("\\", "/").rstrip("/")


def packages_project_rel(manifest: dict | None) -> str:
    if not manifest:
        return "."
    raw = manifest.get("packagesProject")
    if raw is None or raw == "" or raw == ".":
        return "."
    return _normalize_rel_posix(str(raw))


def _project_dir_from_rel(app_root: Path, dir_rel: str) -> Path:
    if dir_rel == ".":
        return app_root
    return app_root / dir_rel


def _pyproject_rel_from_dir_rel(dir_rel: str) -> str:
    if dir_rel == ".":
        return PYPROJECT_FILE
    return f"{dir_rel}/{PYPROJECT_FILE}"


def _shallow_subdir_priority(name: str) -> int:
    lower = name.lower()
    try:
        return PREFERRED_SUBDIRS.index(lower)
    except ValueError:
        return 1000


def _read_manifest(app_root: Path) -> dict | None:
    man_path = app_root / "nora" / "manifest.json"
    if not man_path.is_file():
        return None
    try:
        return json.loads(man_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def discover_pyproject_candidates(
    workspace_root: str | Path,
    *,
    manifest: dict | None | object = _read_manifest,
) -> list[PyprojectCandidate]:
    app_root = Path(workspace_root).resolve()
    if not app_root.is_dir():
        return []

    if manifest is _read_manifest:
        manifest = _read_manifest(app_root)
    elif manifest is None:
        manifest = None

    candidates: list[PyprojectCandidate] = []
    seen: set[str] = set()

    def push(dir_rel: str, source: str, priority: int) -> None:
        norm = _normalize_rel_posix(dir_rel)
        if norm in seen:
            return
        project_dir = _project_dir_from_rel(app_root, norm)
        py_path = project_dir / PYPROJECT_FILE
        if not py_path.is_file():
            return
        seen.add(norm)
        candidates.append(
            PyprojectCandidate(
                dir_rel=norm,
                pyproject_rel=_pyproject_rel_from_dir_rel(norm),
                source=source,
                priority=priority,
            )
        )

    if manifest and manifest.get("packagesProject") is not None:
        raw = str(manifest.get("packagesProject", "")).strip()
        if raw:
            push(packages_project_rel(manifest), "manifest", PRIORITY_MANIFEST)

    push(".", "root", PRIORITY_ROOT)
    push(str(LEGACY_PACKAGES_REL).replace("\\", "/"), "legacy", PRIORITY_LEGACY)

    try:
        entries = list(app_root.iterdir())
    except OSError:
        entries = []

    for ent in entries:
        if not ent.is_dir():
            continue
        name = ent.name
        if name in SKIP_SUBDIRS or name == "nora":
            continue
        sub_priority = PRIORITY_SHALLOW_BASE + _shallow_subdir_priority(name)
        push(name, "shallow", sub_priority)

    candidates.sort(key=lambda c: (c.priority, c.dir_rel))
    return candidates


def resolve_pyproject(
    workspace_root: str | Path,
    *,
    manifest: dict | None | object = _read_manifest,
) -> PyprojectResolution:
    app_root = Path(workspace_root).resolve()
    candidates = discover_pyproject_candidates(workspace_root, manifest=manifest)

    if not candidates:
        return PyprojectResolution(
            ok=False,
            app_root=app_root,
            project_dir=app_root,
            pyproject_path=app_root / PYPROJECT_FILE,
            pyproject_rel=PYPROJECT_FILE,
            source=None,
            candidates=(),
            ambiguous=False,
            alternate_rels=(),
        )

    chosen = candidates[0]
    project_dir = _project_dir_from_rel(app_root, chosen.dir_rel)
    alts = tuple(c.pyproject_rel for c in candidates[1:])

    return PyprojectResolution(
        ok=True,
        app_root=app_root,
        project_dir=project_dir,
        pyproject_path=project_dir / PYPROJECT_FILE,
        pyproject_rel=chosen.pyproject_rel,
        source=chosen.source,
        candidates=tuple(candidates),
        ambiguous=len(candidates) > 1,
        alternate_rels=alts,
    )


def read_pyproject_text(workspace_root: str | Path, *, manifest: dict | None | object = _read_manifest) -> str | None:
    res = resolve_pyproject(workspace_root, manifest=manifest)
    if not res.ok:
        return None
    try:
        return res.pyproject_path.read_text(encoding="utf-8")
    except OSError:
        return None


def parse_pyproject_summary(pyproject_path: str | Path) -> dict:
    """pyproject.toml から requires-python / dependencies 名を抽出（監査用）。"""
    path = Path(pyproject_path)
    out: dict = {"requiresPython": None, "dependencies": []}
    if not path.is_file():
        return out
    try:
        import tomllib

        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out

    project = data.get("project") or {}
    rp = project.get("requires-python") or project.get("requires_python")
    if rp:
        out["requiresPython"] = str(rp)

    deps: list[str] = []
    for item in project.get("dependencies") or []:
        name = str(item).strip().split("[", 1)[0].strip()
        for sep in ("==", ">=", "<=", "~=", "!=", "<", ">"):
            if sep in name:
                name = name.split(sep, 1)[0].strip()
                break
        if name:
            deps.append(name)
    out["dependencies"] = deps
    return out
