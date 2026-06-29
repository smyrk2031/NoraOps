"""連携マップ用 — 状態に応じた運用アクション（秘密なし）。"""

from __future__ import annotations

from typing import Any

from app.core.config import Settings


def _step(text: str, *, link: str = "", link_label: str = "", code: str = "") -> dict[str, str]:
    out: dict[str, str] = {"text": text}
    if link:
        out["link"] = link
    if link_label:
        out["linkLabel"] = link_label
    if code:
        out["code"] = code
    return out


def build_topology_hints(snapshot: dict[str, Any], settings: Settings) -> list[dict[str, Any]]:
    """snapshot + settings から、管理者向けのやることリストを生成。"""
    hints: list[dict[str, Any]] = []
    g = snapshot.get("gitea") or {}
    p = snapshot.get("pypi") or {}
    a = snapshot.get("ai") or {}
    auth = snapshot.get("auth") or {}
    dep = snapshot.get("deployment") or {}

    # --- Gitea ---
    if g.get("status") != "on":
        steps: list[dict[str, str]] = []
        if not (g.get("baseUrl") or "").strip():
            steps.append(
                _step(
                    "Gitea の URL を設定します（例: 社内 Gitea のベース URL）。",
                    code="GITEA_BASE_URL=http://127.0.0.1:3000",
                )
            )
        if not g.get("tokenConfigured"):
            steps.append(
                _step(
                    "サイト管理者用 PAT を発行し、サーバーにだけ設定します（拡張には渡しません）。",
                    code="GITEA_TOKEN=gitea_pat_xxxxxxxx",
                )
            )
        if g.get("tokenIssue"):
            steps.append(
                _step(
                    f"トークン形式に問題があります: {g.get('tokenIssue')}。Gitea で再発行してください。",
                )
            )
        steps.extend(
            [
                _step("`.env` を編集したら FastAPI（uvicorn）を再起動します。"),
                _step(
                    "管理画面の接続設定でも上書きできます（DB 保存・再起動不要の項目あり）。",
                    link="/admin/settings",
                    link_label="接続設定を開く",
                ),
                _step(
                    "設定後、診断で Gitea 到達を確認します。",
                    link="/noraops/diagnostics/run",
                    link_label="動作確認を実行",
                ),
            ]
        )
        hints.append(
            {
                "id": "gitea",
                "severity": "warn",
                "title": "Gitea 未設定 / 接続不可",
                "summary": "このままでは Creator の Gitea 保存・Runner カタログ・artifact が使えません。",
                "steps": steps,
            }
        )
    else:
        hints.append(
            {
                "id": "gitea",
                "severity": "ok",
                "title": "Gitea 接続 OK",
                "summary": f"URL: {g.get('baseUrl') or '—'} · 一覧モード: {g.get('listMode') or '—'}",
                "steps": [
                    _step("拡張から保存・Runner が利用できます。"),
                    _step(
                        "リポが Runner に出ない場合は topic または開発用フラグを確認。",
                        code=f"NORAOPS_PUBLISHED_TOPIC={g.get('publishedTopic') or 'nora-published'}",
                    ),
                    _step("接続の変更", link="/admin/settings", link_label="接続設定"),
                ],
            }
        )

    # --- PyPI ---
    if p.get("status") != "on":
        hints.append(
            {
                "id": "pypi",
                "severity": "info",
                "title": "PyPI ミラー未使用（PyPI 直）",
                "summary": "開発ではこのままで問題ないことが多いです。社内のみでパッケージを制限したいときだけ設定します。",
                "steps": [
                    _step(
                        "社内 pypiserver + ARR を用意し、simple index URL を設定。",
                        code="NORAOPS_PYPI_INDEX_URL=http://127.0.0.1:8000/pypi/simple/",
                    ),
                    _step("許可リストを登録します。", link="/admin/packages", link_label="パッケージ許可"),
                    _step("詳細は PyPI ミラー運用ドキュメントを参照。"),
                ],
            }
        )
    elif (p.get("allowlistCount") or 0) <= 0:
        hints.append(
            {
                "id": "pypi",
                "severity": "warn",
                "title": "PyPI ミラーは有効だが許可リストが空",
                "summary": "index は設定済みですが、許可パッケージが 0 件です。uv sync が失敗する可能性があります。",
                "steps": [
                    _step("Excel または UI から許可パッケージを登録。", link="/admin/packages", link_label="パッケージ許可"),
                    _step("登録後、拡張を開き直すと runtime-config に反映されます。"),
                ],
            }
        )
    else:
        hints.append(
            {
                "id": "pypi",
                "severity": "ok",
                "title": "PyPI ミラー + 許可リスト OK",
                "summary": f"{p.get('allowlistCount')} 件登録 · フォールバック: {'ON' if p.get('fallbackEnabled') else 'OFF'}",
                "steps": [
                    _step("拡張の uv は社内 index を参照します。", link="/admin/packages", link_label="許可リスト管理"),
                ],
            }
        )

    # --- Auth ---
    mode = auth.get("mode") or "open"
    if mode == "open":
        hints.append(
            {
                "id": "auth",
                "severity": "info",
                "title": "認証: open（開発モード）",
                "summary": "誰でも push セッションを取れる開発向け設定です。本番では変更を推奨します。",
                "steps": [
                    _step(
                        "本番ではメール登録方式に切り替え。",
                        code="NORAOPS_AUTH_MODE=email_token",
                    ),
                    _step("SMTP または HTTP メール API を設定（有効化メール用）。"),
                    _step("CMS・ポリシー", link="/admin/cms", link_label="CMS を開く"),
                ],
            }
        )
    elif mode == "email_token":
        mail_ok = bool(
            (settings.noraops_smtp_host or "").strip()
            or (settings.noraops_mail_http_url or "").strip()
        )
        if not mail_ok:
            hints.append(
                {
                    "id": "auth",
                    "severity": "warn",
                    "title": "email_token だがメール未設定",
                    "summary": "登録・有効化メールが送れません。SMTP または HTTP メール API を設定してください。",
                    "steps": [
                        _step("SMTP を設定", code="NORAOPS_SMTP_HOST=... NORAOPS_SMTP_FROM=..."),
                        _step("または HTTP メール API", code="NORAOPS_MAIL_PROVIDER=http NORAOPS_MAIL_HTTP_URL=..."),
                    ],
                }
            )
        else:
            hints.append(
                {
                    "id": "auth",
                    "severity": "ok",
                    "title": "認証: email_token（本番向け）",
                    "summary": auth.get("label") or "",
                    "steps": [
                        _step("ユーザはメール登録 → 有効化 → NoraAccessToken で拡張接続。"),
                        _step(
                            "Gitea 自動プロビジョン",
                            code=f"NORAOPS_GITEA_AUTO_PROVISION={'1' if auth.get('giteaAutoProvision') else '0'}",
                        ),
                    ],
                }
            )
    else:
        hints.append(
            {
                "id": "auth",
                "severity": "ok",
                "title": f"認証: {mode}",
                "summary": auth.get("label") or "",
                "steps": [_step("詳細は「認証モードとGitea運用」ドキュメントを参照。")],
            }
        )

    # --- AI ---
    if a.get("status") != "on":
        if a.get("enabled") and not a.get("configured"):
            hints.append(
                {
                    "id": "ai",
                    "severity": "warn",
                    "title": "AI 有効だが Azure 未設定",
                    "summary": "NORAOPS_AI_ENABLED=1 ですが Azure OpenAI の endpoint / key が不足しています。",
                    "steps": [
                        _step("Azure OpenAI の接続情報を .env に設定。"),
                        _step("または一旦 OFF", code="NORAOPS_AI_ENABLED=0"),
                        _step("CMS で機能フラグ", link="/admin/cms", link_label="CMS（AI 設定）"),
                    ],
                }
            )
        else:
            hints.append(
                {
                    "id": "ai",
                    "severity": "info",
                    "title": "AI 踏み台 OFF",
                    "summary": "Copilot BYOK は使いません。xLLM（外部 AI 直）や拡張のみの利用ならこのままで OK です。",
                    "steps": [
                        _step("有効化する場合", code="NORAOPS_AI_ENABLED=1"),
                        _step("Azure 設定後 CMS で確認", link="/admin/cms", link_label="CMS"),
                        _step("利用量", link="/noraops/ai-usage", link_label="AI 利用量"),
                    ],
                }
            )
    else:
        hints.append(
            {
                "id": "ai",
                "severity": "ok",
                "title": "AI 踏み台 ON",
                "summary": "Azure OpenAI 経由の Copilot BYOK が利用可能です。",
                "steps": [
                    _step("CMS で日次上限・機能フラグを調整。", link="/admin/cms", link_label="CMS"),
                    _step("利用状況", link="/noraops/ai-usage", link_label="AI 利用量"),
                ],
            }
        )

    # --- Deployment / IIS ---
    if (dep.get("env") or "") == "prod" and (dep.get("rootPath") or "/") == "/":
        hints.append(
            {
                "id": "deploy",
                "severity": "info",
                "title": "本番 env だがサブパス未設定",
                "summary": "IIS サブパス配備の場合は NORAOPS_ROOT_PATH を設定してください。",
                "steps": [
                    _step("IIS ARR 配備時", code="NORAOPS_ROOT_PATH=/NoraOps"),
                    _step("外向き URL", code="NORAOPS_PUBLIC_BASE_URL=https://intranet.example/NoraOps"),
                ],
            }
        )

    return hints


def hints_for_id(hints: list[dict[str, Any]], hint_id: str) -> dict[str, Any] | None:
    for h in hints:
        if h.get("id") == hint_id:
            return h
    return None


def action_items(hints: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """warn / info で要対応っぽいものだけ（ok は除外可）。"""
    order = {"warn": 0, "info": 1, "ok": 2}
    return sorted(
        [h for h in hints if h.get("severity") in ("warn", "info")],
        key=lambda h: order.get(h.get("severity"), 9),
    )
