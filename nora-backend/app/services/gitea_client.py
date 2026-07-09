from __future__ import annotations

from typing import Any

import httpx

from app.core.httpx_client import create_async_client
from app.services.admin_config_service import RuntimeIntegrationConfig
from app.services.gitea_token_check import classify_gitea_token, parse_gitea_scope_error


class GiteaClientError(Exception):
    """Raised when Gitea API cannot be reached or returns an error."""

    def __init__(self, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.hint = hint or (
            "Set GITEA_BASE_URL to a reachable URL (e.g. http://127.0.0.1:3000), "
            "GITEA_TOKEN, and GITEA_ORGS in .env or /admin/settings."
        )


class GiteaClient:
    def __init__(self, cfg: RuntimeIntegrationConfig) -> None:
        self._cfg = cfg

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self._cfg.gitea_token:
            headers["Authorization"] = f"token {self._cfg.gitea_token}"
        return headers

    def _list_mode(self) -> str:
        raw = (self._cfg.gitea_list_mode or "instance").strip().lower()
        if raw in ("scoped", "all_orgs", "instance"):
            return raw
        return "instance"

    async def list_org_repos(self) -> list[dict[str, Any]]:
        """List repos according to ``gitea_list_mode`` (see ``GITEA_LIST_MODE``)."""
        if not self._cfg.gitea_base_url:
            return []

        base = (self._cfg.gitea_base_url or "").rstrip("/")
        mode = self._list_mode()
        if mode == "instance":
            return await self._paginated_repo_search(base)
        if mode == "all_orgs":
            return await self._fetch_repos_all_orgs_admin(base)

        # --- scoped: explicit org list, or token user's repos when orgs empty ---
        if not self._cfg.gitea_orgs:
            if not self._cfg.gitea_token:
                return []
            return await self._paginated_get(
                base,
                f"{base}/api/v1/user/repos",
                error_label="user repos",
            )

        all_repos: list[dict[str, Any]] = []
        try:
            async with create_async_client(timeout=20.0, headers=self._headers()) as client:
                for org in self._cfg.gitea_orgs:
                    url = f"{base}/api/v1/orgs/{org}/repos"
                    try:
                        chunk = await self._paginated_get(
                            base,
                            url,
                            error_label=f"org '{org}'",
                            client=client,
                        )
                    except GiteaClientError as e:
                        if "404" in str(e):
                            raise GiteaClientError(
                                str(e),
                                hint=(
                                    "その組織名が Gitea にありません。Gitea で Organization を作成するか、"
                                    "GITEA_ORGS を既存の組織名に合わせてください。"
                                    "組織を使わない場合は GITEA_LIST_MODE=instance とし、"
                                    "サイト管理者 PAT で全インスタンスを横断するか、"
                                    "GITEA_ORGS を空にして GITEA_TOKEN の個人リポのみに限定できます。"
                                ),
                            ) from e
                        raise
                    all_repos.extend(chunk)
        except GiteaClientError:
            raise
        except httpx.ConnectError as e:
            raise GiteaClientError(
                f"Cannot connect to Gitea at {base!r}: {e}",
                hint=(
                    "DNS/hostname failed (getaddrinfo). Use http://127.0.0.1:3000 (or your real host), "
                    "not placeholder hosts like gitea.example.local."
                ),
            ) from e
        except httpx.TimeoutException as e:
            raise GiteaClientError(f"Gitea request timed out ({base}): {e}") from e
        return all_repos

    @staticmethod
    def _dedupe_repos(repos: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: dict[Any, dict[str, Any]] = {}
        for r in repos:
            key = r.get("id")
            if key is None:
                key = (r.get("full_name") or r.get("name") or "").strip() or None
            if key is None:
                continue
            if key not in seen:
                seen[key] = r
        return list(seen.values())

    @staticmethod
    def _missing_read_user_scope(exc: GiteaClientError) -> bool:
        msg = str(exc).lower()
        return "403" in msg and "read:user" in msg

    async def _paginated_repo_search(self, base: str) -> list[dict[str, Any]]:
        """Instance-wide listing: ``repos/search`` plus (optional) ``/user/repos``."""
        collected = await self._search_repos_paginated(base)
        if not self._cfg.gitea_token:
            return collected
        try:
            user_repos = await self._paginated_get(
                base,
                f"{base}/api/v1/user/repos",
                error_label="user repos",
            )
            return self._dedupe_repos(collected + user_repos)
        except GiteaClientError as e:
            # PAT に read:user が無いと 403 — repos/search の結果だけで続行（Runner カタログ等）
            if self._missing_read_user_scope(e):
                return collected
            raise

    async def _search_repos_paginated(self, base: str) -> list[dict[str, Any]]:
        """``GET /api/v1/repos/search`` — unauthenticated 時は ``private`` を送らない（一部 Gitea で空になるのを避ける）。"""
        url = f"{base}/api/v1/repos/search"
        collected: list[dict[str, Any]] = []
        page = 1
        limit = self._cfg.gitea_default_per_page
        try:
            async with create_async_client(timeout=30.0, headers=self._headers()) as client:
                while True:
                    params: dict[str, Any] = {"page": page, "limit": limit}
                    if self._cfg.gitea_token:
                        params["private"] = True
                    resp = await client.get(url, params=params)
                    if resp.status_code == 422 and "q" not in params:
                        params["q"] = " "
                        resp = await client.get(url, params=params)
                    try:
                        resp.raise_for_status()
                    except httpx.HTTPStatusError as e:
                        body = (resp.text or "")[:300]
                        raise GiteaClientError(
                            f"Gitea repos/search error {resp.status_code}: {body or str(e)}",
                            hint=(
                                "トークンが無い場合は公開リポのみの可能性があります。"
                                "インスタンス全体を把握するにはサイト管理者の PAT を GITEA_TOKEN に設定してください。"
                            ),
                        ) from e
                    payload = resp.json()
                    data = payload.get("data") if isinstance(payload, dict) else None
                    if not isinstance(data, list):
                        break
                    if not data:
                        break
                    collected.extend(data)
                    if len(data) < limit:
                        break
                    page += 1
        except GiteaClientError:
            raise
        except httpx.ConnectError as e:
            raise GiteaClientError(
                f"Cannot connect to Gitea at {base!r}: {e}",
                hint=(
                    "DNS/hostname failed (getaddrinfo). Use http://127.0.0.1:3000 (or your real host), "
                    "not placeholder hosts like gitea.example.local."
                ),
            ) from e
        except httpx.TimeoutException as e:
            raise GiteaClientError(f"Gitea request timed out ({base}): {e}") from e
        return collected

    async def _fetch_repos_all_orgs_admin(self, base: str) -> list[dict[str, Any]]:
        """List every org's repos using ``GET /api/v1/admin/orgs`` (requires site-admin token)."""
        if not self._cfg.gitea_token:
            return []

        orgs_url = f"{base}/api/v1/admin/orgs"
        all_repos: list[dict[str, Any]] = []
        try:
            async with create_async_client(timeout=30.0, headers=self._headers()) as client:
                page = 1
                limit = self._cfg.gitea_default_per_page
                while True:
                    resp = await client.get(orgs_url, params={"page": page, "limit": limit})
                    try:
                        resp.raise_for_status()
                    except httpx.HTTPStatusError as e:
                        body = (resp.text or "")[:300]
                        hint = (
                            "GITEA_LIST_MODE=all_orgs はサイト管理者 API です。"
                            "一般トークンでは 403 になります。サイト管理者 PAT を使うか、"
                            "GITEA_LIST_MODE=instance（推奨）に切り替えてください。"
                        )
                        raise GiteaClientError(
                            f"Gitea admin/orgs error {resp.status_code}: {body or str(e)}",
                            hint=hint,
                        ) from e
                    orgs = resp.json()
                    if not isinstance(orgs, list) or not orgs:
                        break
                    for org in orgs:
                        name = ""
                        if isinstance(org, dict):
                            name = str(org.get("username") or org.get("name") or "").strip()
                        if not name:
                            continue
                        chunk = await self._paginated_get(
                            base,
                            f"{base}/api/v1/orgs/{name}/repos",
                            error_label=f"org '{name}'",
                            client=client,
                        )
                        all_repos.extend(chunk)
                    if len(orgs) < limit:
                        break
                    page += 1
        except GiteaClientError:
            raise
        except httpx.ConnectError as e:
            raise GiteaClientError(
                f"Cannot connect to Gitea at {base!r}: {e}",
                hint=(
                    "DNS/hostname failed (getaddrinfo). Use http://127.0.0.1:3000 (or your real host), "
                    "not placeholder hosts like gitea.example.local."
                ),
            ) from e
        except httpx.TimeoutException as e:
            raise GiteaClientError(f"Gitea request timed out ({base}): {e}") from e
        return all_repos

    async def _paginated_get(
        self,
        base: str,
        url: str,
        *,
        error_label: str,
        client: httpx.AsyncClient | None = None,
    ) -> list[dict[str, Any]]:
        params = {"page": 1, "limit": self._cfg.gitea_default_per_page}
        collected: list[dict[str, Any]] = []

        async def run(c: httpx.AsyncClient) -> None:
            nonlocal params
            while True:
                resp = await c.get(url, params=params)
                try:
                    resp.raise_for_status()
                except httpx.HTTPStatusError as e:
                    body = (resp.text or "")[:300]
                    hint = "Check GITEA_TOKEN scopes and that the org name exists."
                    if resp.status_code == 403 and "read:user" in body and "user repos" in error_label:
                        hint = (
                            "この API には Gitea トークンに read:user が必要です。"
                            "トークンに read:user を追加するか、GITEA_LIST_MODE=instance のまま "
                            "repos/search のみ使う運用（サーバは read:user 無しでも続行可能）にしてください。"
                        )
                    raise GiteaClientError(
                        f"Gitea API error {resp.status_code} for {error_label}: {body or str(e)}",
                        hint=hint,
                    ) from e
                repos = resp.json()
                if not repos:
                    break
                collected.extend(repos)
                params = {**params, "page": params["page"] + 1}

        try:
            if client is not None:
                await run(client)
            else:
                async with create_async_client(timeout=20.0, headers=self._headers()) as c:
                    await run(c)
        except GiteaClientError:
            raise
        except httpx.ConnectError as e:
            raise GiteaClientError(
                f"Cannot connect to Gitea at {base!r}: {e}",
                hint=(
                    "DNS/hostname failed (getaddrinfo). Use http://127.0.0.1:3000 (or your real host), "
                    "not placeholder hosts like gitea.example.local."
                ),
            ) from e
        except httpx.TimeoutException as e:
            raise GiteaClientError(f"Gitea request timed out ({base}): {e}") from e
        return collected

    async def get_current_user(self) -> dict[str, Any] | None:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            return None
        base = self._cfg.gitea_base_url.rstrip("/")
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.get(f"{base}/api/v1/user")
                if resp.status_code != 200:
                    return None
                return resp.json()
        except httpx.HTTPError:
            return None

    async def get_user(self, login: str) -> dict[str, Any] | None:
        if not self._cfg.gitea_base_url or not login:
            return None
        base = self._cfg.gitea_base_url.rstrip("/")
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.get(f"{base}/api/v1/users/{login}")
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError:
            return None
        except httpx.HTTPError:
            return None

    async def admin_create_user(
        self,
        *,
        username: str,
        email: str,
        password: str,
        full_name: str = "",
    ) -> dict[str, Any]:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN (admin) are required.")
        base = self._cfg.gitea_base_url.rstrip("/")
        body = {
            "username": username,
            "email": email,
            "password": password,
            "full_name": full_name or username,
            "must_change_password": False,
            "send_notify": False,
        }
        try:
            async with create_async_client(timeout=20.0, headers=self._headers()) as client:
                resp = await client.post(f"{base}/api/v1/admin/users", json=body)
                if resp.status_code == 422:
                    existing = await self.get_user(username)
                    if existing:
                        return existing
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            raise GiteaClientError(
                f"Gitea admin create user failed {e.response.status_code}: {body}",
                hint="サイト管理者 PAT が必要です。",
            ) from e
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def admin_create_user_token(self, username: str, token_name: str) -> str:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN (admin) are required.")
        base = self._cfg.gitea_base_url.rstrip("/")
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.post(
                    f"{base}/api/v1/admin/users/{username}/tokens",
                    json={"name": token_name},
                )
                resp.raise_for_status()
                data = resp.json()
                return str(data.get("sha1") or data.get("token") or "")
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            raise GiteaClientError(
                f"Gitea admin create token failed {e.response.status_code}: {body}",
                hint="管理者 PAT でユーザトークンを発行できるか確認してください。",
            ) from e
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def admin_delete_user(self, username: str) -> None:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN (admin) are required.")
        login = (username or "").strip()
        if not login:
            raise GiteaClientError("username is required.")
        base = self._cfg.gitea_base_url.rstrip("/")
        try:
            async with create_async_client(timeout=20.0, headers=self._headers()) as client:
                resp = await client.delete(f"{base}/api/v1/admin/users/{login}")
                if resp.status_code == 404:
                    return
                resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            raise GiteaClientError(
                f"Gitea admin delete user failed {e.response.status_code}: {body}",
                hint="ユーザにリポジトリが残っていると削除できません。",
            ) from e
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def list_accessible_repos(self, *, limit: int = 200) -> list[dict[str, Any]]:
        """Repos the token user can access (owner + collaborator)."""
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            return []
        base = self._cfg.gitea_base_url.rstrip("/")
        return await self._paginated_get(
            base,
            f"{base}/api/v1/user/repos",
            error_label="user repos",
        )

    async def list_collaborators(self, owner: str, name: str) -> list[dict[str, Any]]:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            return []
        base = self._cfg.gitea_base_url.rstrip("/")
        url = f"{base}/api/v1/repos/{owner}/{name}/collaborators"
        try:
            return await self._paginated_get(base, url, error_label="collaborators")
        except GiteaClientError:
            return []

    async def add_collaborator(
        self,
        owner: str,
        name: str,
        username: str,
        *,
        permission: str = "write",
    ) -> None:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN are required.")
        base = self._cfg.gitea_base_url.rstrip("/")
        perm = (permission or "write").strip().lower()
        if perm not in ("read", "write", "admin"):
            perm = "write"
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.put(
                    f"{base}/api/v1/repos/{owner}/{name}/collaborators/{username}",
                    json={"permission": perm},
                )
                if resp.status_code == 422:
                    body = (resp.text or "")[:300]
                    raise GiteaClientError(f"Cannot add collaborator: {body}")
                resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            raise GiteaClientError(
                f"Gitea add collaborator failed {e.response.status_code}: {body}",
                hint="リポジトリのオーナー権限が必要です。",
            ) from e
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def delete_collaborator(self, owner: str, name: str, username: str) -> None:
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN are required.")
        base = self._cfg.gitea_base_url.rstrip("/")
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.delete(
                    f"{base}/api/v1/repos/{owner}/{name}/collaborators/{username}"
                )
                if resp.status_code == 404:
                    return
                resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            raise GiteaClientError(
                f"Gitea delete collaborator failed {e.response.status_code}: {body}",
            ) from e
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def set_repo_topics(self, owner: str, name: str, topics: list[str]) -> dict[str, Any]:
        """Replace repository topics (requires write:repository)."""
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN are required to set topics.")
        base = self._cfg.gitea_base_url.rstrip("/")
        url = f"{base}/api/v1/repos/{owner}/{name}/topics"
        unique = []
        seen: set[str] = set()
        for t in topics:
            s = str(t).strip()
            if s and s not in seen:
                seen.add(s)
                unique.append(s)
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.put(url, json={"topics": unique})
                resp.raise_for_status()
                return resp.json() if resp.content else {"topics": unique}
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            raise GiteaClientError(
                f"Gitea set topics error {e.response.status_code}: {body}",
                hint="トークンに write:repository が必要です。",
            ) from e
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def get_repo(self, owner: str, name: str) -> dict[str, Any] | None:
        if not self._cfg.gitea_base_url:
            return None
        base = self._cfg.gitea_base_url.rstrip("/")
        url = f"{base}/api/v1/repos/{owner}/{name}"
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.get(url)
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError:
            return None
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def update_repo_default_branch(self, owner: str, name: str, branch: str) -> dict[str, Any]:
        """Set repository default branch (requires write:repository)."""
        if not self._cfg.gitea_base_url or not self._cfg.gitea_token:
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN are required to update repos.")
        base = self._cfg.gitea_base_url.rstrip("/")
        url = f"{base}/api/v1/repos/{owner}/{name}"
        branch_name = (branch or "").strip()
        if not branch_name:
            raise GiteaClientError("Branch name is required.")
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.patch(url, json={"default_branch": branch_name})
                resp.raise_for_status()
                return resp.json() if resp.content else {"default_branch": branch_name}
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            raise GiteaClientError(
                f"Gitea update repo error {e.response.status_code}: {body}",
                hint="トークンに write:repository が必要です。",
            ) from e
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def get_repo_by_id(self, repo_id: int) -> dict[str, Any] | None:
        if not self._cfg.gitea_base_url:
            return None
        rid = int(repo_id)
        if rid <= 0:
            return None
        base = self._cfg.gitea_base_url.rstrip("/")
        url = f"{base}/api/v1/repositories/{rid}"
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.get(url)
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError:
            return None
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot reach Gitea: {e}") from e

    async def create_repo(
        self,
        owner: str,
        name: str,
        *,
        private: bool = True,
        description: str = "",
        auto_init: bool = False,
    ) -> dict[str, Any]:
        token_info = classify_gitea_token(self._cfg.gitea_token)
        if not self._cfg.gitea_base_url or not token_info.get("configured"):
            raise GiteaClientError("GITEA_BASE_URL and GITEA_TOKEN are required to create repos.")
        base = self._cfg.gitea_base_url.rstrip("/")
        body: dict[str, Any] = {
            "name": name,
            "private": private,
            "description": description or "",
            "auto_init": auto_init,
        }
        if self._cfg.gitea_orgs:
            url = f"{base}/api/v1/orgs/{owner}/repos"
        else:
            url = f"{base}/api/v1/user/repos"
        try:
            async with create_async_client(timeout=20.0, headers=self._headers()) as client:
                resp = await client.post(url, json=body)
                if resp.status_code == 409:
                    existing = await self.get_repo(owner, name)
                    raise GiteaClientError(
                        f"Repository {owner}/{name} already exists.",
                        hint="Choose another app name.",
                    ) from None
                if resp.status_code == 403:
                    scope_msg = parse_gitea_scope_error(resp.text or "")
                    hint = (
                        "Gitea 1.26 の POST /user/repos には write:user が必要です。"
                        "トークン作成で user を「読み取りと書き込み」、repository も「読み取りと書き込み」にしてください。"
                    )
                    if scope_msg:
                        hint = f"{scope_msg}\n{hint}"
                    raise GiteaClientError(
                        "Gitea rejected repo creation (403 Forbidden).",
                        hint=hint,
                    )
                resp.raise_for_status()
                return resp.json()
        except GiteaClientError:
            raise
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Gitea create repo failed: {e}") from e

    async def probe_create_permission(self) -> dict[str, Any]:
        """Check whether the configured token can POST /user/repos (creates then deletes a probe repo)."""
        token_info = classify_gitea_token(self._cfg.gitea_token)
        if not self._cfg.gitea_base_url or not token_info.get("configured"):
            return {"ok": False, "reason": "not_configured"}
        base = self._cfg.gitea_base_url.rstrip("/")
        probe_name = "__noraops_probe__"
        try:
            async with create_async_client(timeout=15.0, headers=self._headers()) as client:
                resp = await client.post(
                    f"{base}/api/v1/user/repos",
                    json={"name": probe_name, "private": True},
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    own = (data.get("owner") or {}).get("login") or ""
                    name = data.get("name") or probe_name
                    if own:
                        await client.delete(f"{base}/api/v1/repos/{own}/{name}")
                    return {"ok": True}
                if resp.status_code == 409:
                    return {"ok": True, "note": "probe_repo_exists"}
                if resp.status_code == 403:
                    scope_msg = parse_gitea_scope_error(resp.text or "")
                    hint = "user と repository を「読み取りと書き込み」にした PAT を .env に設定してください。"
                    if scope_msg:
                        hint = scope_msg
                    return {"ok": False, "reason": "forbidden", "hint": hint}
                return {"ok": False, "reason": f"http_{resp.status_code}", "body": (resp.text or "")[:200]}
        except httpx.HTTPError as e:
            return {"ok": False, "reason": "network", "hint": str(e)}

    async def latest_release(self, owner: str, repo: str) -> dict[str, Any] | None:
        if not self._cfg.gitea_base_url:
            return None
        base = (self._cfg.gitea_base_url or "").rstrip("/")
        url = f"{base}/api/v1/repos/{owner}/{repo}/releases/latest"
        try:
            async with create_async_client(timeout=20.0, headers=self._headers()) as client:
                resp = await client.get(url)
                if resp.status_code == 404:
                    return None
                try:
                    resp.raise_for_status()
                except httpx.HTTPStatusError as e:
                    body = (resp.text or "")[:300]
                    raise GiteaClientError(
                        f"Gitea releases/latest error {resp.status_code}: {body or str(e)}",
                        hint="Check token and repo access.",
                    ) from e
                return resp.json()
        except GiteaClientError:
            raise
        except httpx.ConnectError as e:
            raise GiteaClientError(
                f"Cannot connect to Gitea at {base!r}: {e}",
                hint="Fix GITEA_BASE_URL in .env (e.g. http://127.0.0.1:3000).",
            ) from e
        except httpx.TimeoutException as e:
            raise GiteaClientError(f"Gitea request timed out ({base}): {e}") from e

    async def download_repo_archive(
        self,
        owner: str,
        name: str,
        *,
        archive: str = "zip",
    ) -> bytes:
        """Download repository archive zip (default branch)."""
        if not self._cfg.gitea_base_url:
            raise GiteaClientError("GITEA_BASE_URL is required to download repo archives.")
        base = self._cfg.gitea_base_url.rstrip("/")
        url = f"{base}/api/v1/repos/{owner}/{name}/archive/{archive}"
        try:
            async with create_async_client(timeout=120.0, headers=self._headers()) as client:
                resp = await client.get(url)
                if resp.status_code == 404 and archive == "zip":
                    repo = await self.get_repo(owner, name)
                    branch = "main"
                    if repo:
                        branch = str(repo.get("default_branch") or "main").strip() or "main"
                    resp = await client.get(f"{base}/api/v1/repos/{owner}/{name}/archive/{branch}.zip")
                resp.raise_for_status()
                data = resp.content
                if not data:
                    raise GiteaClientError(f"Empty archive for {owner}/{name}")
                return data
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            raise GiteaClientError(
                f"Gitea archive error {e.response.status_code} for {owner}/{name}: {body}",
                hint="トークンに repository 読み取り権限があるか確認してください。",
            ) from e
        except httpx.HTTPError as e:
            raise GiteaClientError(f"Cannot download archive for {owner}/{name}: {e}") from e
