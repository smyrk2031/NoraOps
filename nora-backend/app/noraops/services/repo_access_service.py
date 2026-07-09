"""Repository access checks and member resolution (Gitea is source of truth)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import NoraOpsUser
from app.noraops.auth.email_util import normalize_email
from app.services.gitea_client import GiteaClient, GiteaClientError


class RepoAccessError(ValueError):
    def __init__(self, code: str, message: str, *, hint: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.hint = hint


def strict_repo_access(settings: Settings) -> bool:
    return bool(settings.is_email_token_auth or settings.is_windows_trust_auth)


def resolve_email_to_gitea_login(db: Session, email: str) -> str | None:
    norm = normalize_email(email)
    if not norm:
        return None
    row = db.scalar(select(NoraOpsUser).where(NoraOpsUser.verified_email == norm).limit(1))
    if not row or not row.gitea_login:
        return None
    return row.gitea_login.strip()


def repo_permissions(repo: dict | None) -> dict[str, bool]:
    if not repo:
        return {"admin": False, "push": False, "pull": False}
    perms = repo.get("permissions") or {}
    return {
        "admin": bool(perms.get("admin")),
        "push": bool(perms.get("push")),
        "pull": bool(perms.get("pull")),
    }


def can_write_repo(repo: dict | None) -> bool:
    perms = repo_permissions(repo)
    return perms["admin"] or perms["push"]


async def assert_repo_write_access(
    client: GiteaClient,
    owner: str,
    name: str,
    *,
    actor_login: str | None,
    allow_create_as_actor: bool = False,
) -> dict | None:
    """
    Raise RepoAccessError if the current client token cannot write to owner/name.
    Returns existing repo dict when present.
    """
    own, repo_name = owner.strip(), name.strip()
    existing = await client.get_repo(own, repo_name)
    if existing:
        if not can_write_repo(existing):
            raise RepoAccessError(
                "repo_forbidden",
                f"リポジトリ {own}/{repo_name} への書き込み権限がありません。",
                hint="オーナーにメンバー追加を依頼するか、別のリポジトリを選んでください。",
            )
        return existing

    if not allow_create_as_actor:
        raise RepoAccessError(
            "repo_not_found",
            f"リポジトリ {own}/{repo_name} が見つかりません。",
            hint="先に「新規リポジトリを作成」するか、保存先を切り替えてください。",
        )

    if actor_login and own != actor_login.strip():
        raise RepoAccessError(
            "repo_forbidden",
            f"リポジトリ {own}/{repo_name} を新規作成する権限がありません（owner={own}）。",
            hint="自分の Gitea ユーザ名を owner にするか、オーナーに作成を依頼してください。",
        )
    return None


def repo_role(repo: dict, actor_login: str) -> str:
    login = (actor_login or "").strip()
    owner_obj = repo.get("owner") or {}
    owner_login = owner_obj.get("login") if isinstance(owner_obj, dict) else str(owner_obj or "")
    if login and owner_login == login:
        return "owner"
    perms = repo_permissions(repo)
    if perms["admin"]:
        return "admin"
    if perms["push"]:
        return "write"
    if perms["pull"]:
        return "read"
    return "none"


def repo_summary(repo: dict, *, actor_login: str = "") -> dict:
    owner_obj = repo.get("owner") or {}
    owner = owner_obj.get("login") if isinstance(owner_obj, dict) else str(owner_obj or "")
    name = repo.get("name") or ""
    base = (repo.get("html_url") or "").rsplit("/", 2)[0] if repo.get("html_url") else ""
    clone = repo.get("clone_url") or repo.get("ssh_url") or ""
    if not clone and base and owner and name:
        clone = f"{base}/{owner}/{name}.git"
    return {
        "owner": owner,
        "name": name,
        "fullName": repo.get("full_name") or f"{owner}/{name}",
        "cloneUrl": clone,
        "htmlUrl": repo.get("html_url") or "",
        "private": bool(repo.get("private")),
        "giteaRepoId": int(repo.get("id") or 0) or None,
        "role": repo_role(repo, actor_login),
        "permissions": repo_permissions(repo),
    }
