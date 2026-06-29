"""Azure OpenAI gateway — 組織中継（API キーはサーバー側のみ保持）。"""

from __future__ import annotations

import json
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.core.config import Settings
from app.core.httpx_client import create_async_client
from app.noraops.services.ai_runtime_settings import AiRuntimeSettings

_MAX_USAGE_EVENTS = 3000
_PROXY_API_KEY = "noraops-proxy"


def _usage_path(settings: Settings) -> Path:
    return settings.artifacts_abs_dir.parent / "ai-usage.json"


def _load_usage(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"days": {}, "events": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"days": {}, "events": []}
    if "events" not in data:
        data["events"] = []
    return data


def _save_usage(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_today_usage(settings: Settings) -> dict[str, int]:
    path = _usage_path(settings)
    data = _load_usage(path)
    key = date.today().isoformat()
    day = data.get("days", {}).get(key, {})
    return {
        "tokens_in": int(day.get("tokens_in", 0)),
        "tokens_out": int(day.get("tokens_out", 0)),
    }


def record_usage(
    settings: Settings,
    tokens_in: int,
    tokens_out: int,
    *,
    source: str = "chat",
    app_id: str = "",
    repo_owner: str = "",
    repo_name: str = "",
) -> None:
    path = _usage_path(settings)
    data = _load_usage(path)
    key = date.today().isoformat()
    days = data.setdefault("days", {})
    day = days.setdefault(key, {"tokens_in": 0, "tokens_out": 0})
    tin = max(0, tokens_in)
    tout = max(0, tokens_out)
    day["tokens_in"] = int(day.get("tokens_in", 0)) + tin
    day["tokens_out"] = int(day.get("tokens_out", 0)) + tout
    app_key = (app_id or "").strip()
    repo_key = ""
    if repo_owner and repo_name:
        repo_key = f"{repo_owner}/{repo_name}"
    if app_key or repo_key:
        by_app = data.setdefault("by_app", {})
        bucket = by_app.setdefault(
            app_key or repo_key,
            {
                "app_id": app_key,
                "repo_owner": repo_owner or "",
                "repo_name": repo_name or "",
                "repo_label": repo_key,
                "tokens_in": 0,
                "tokens_out": 0,
            },
        )
        bucket["tokens_in"] = int(bucket.get("tokens_in", 0)) + tin
        bucket["tokens_out"] = int(bucket.get("tokens_out", 0)) + tout
    events: list = data.setdefault("events", [])
    events.append(
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "date": key,
            "source": source or "chat",
            "tokens_in": tin,
            "tokens_out": tout,
            "tokens_total": tin + tout,
            "app_id": app_key,
            "repo_owner": repo_owner or "",
            "repo_name": repo_name or "",
            "repo_label": repo_key,
        }
    )
    if len(events) > _MAX_USAGE_EVENTS:
        data["events"] = events[-_MAX_USAGE_EVENTS:]
    _save_usage(path, data)


def enrich_messages_with_mcp(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """MCP ソース定義（when に ai.chat）を system プロンプトへ簡易注入。"""
    try:
        from app.services.cms_rules import read_mcp_sources_parsed

        data = read_mcp_sources_parsed()
    except Exception:
        return messages
    snippets: list[str] = []
    for s in data.get("sources") or []:
        when = s.get("when") or []
        if "ai.chat" not in when:
            continue
        title = s.get("title") or s.get("id") or "knowledge"
        snippet = (s.get("promptSnippet") or s.get("summary") or "").strip()
        if snippet:
            snippets.append(f"### {title}\n{snippet}")
    if not snippets:
        return messages
    block = (
        "以下は組織ナレッジ（MCP 登録済み）です。回答に活用してください:\n\n"
        + "\n\n".join(snippets)
    )
    out = [dict(m) for m in messages]
    if out and out[0].get("role") == "system":
        out[0]["content"] = str(out[0].get("content") or "") + "\n\n" + block
    else:
        out.insert(0, {"role": "system", "content": block})
    return out


def ai_configured(settings: Settings) -> bool:
    return bool(
        settings.azure_openai_endpoint.strip()
        and settings.azure_openai_api_key.strip()
        and settings.azure_openai_deployment.strip()
    )


def build_status(settings: Settings, runtime: AiRuntimeSettings | None = None) -> dict[str, Any]:
    usage = get_today_usage(settings)
    limit = max(0, int(settings.noraops_ai_daily_token_limit))
    total = usage["tokens_in"] + usage["tokens_out"]
    blocked = limit > 0 and total >= limit
    endpoint = settings.azure_openai_endpoint.strip().rstrip("/")
    if runtime is None:
        ai_on = bool(settings.noraops_ai_enabled)
        copilot_on = ai_on and bool(settings.noraops_copilot_enabled)
        continue_on = ai_on and bool(settings.noraops_continue_enabled)
        cms_override = False
    else:
        ai_on = runtime.enabled
        copilot_on = runtime.copilot_enabled
        continue_on = runtime.continue_enabled
        cms_override = runtime.cms_override
    copilot_min = (settings.noraops_copilot_min_host_version or "1.122.0").strip()
    client_min = (settings.noraops_client_min_host_version or "1.88.0").strip()
    if copilot_on and continue_on:
        recommended = "copilot"
    elif copilot_on:
        recommended = "copilot"
    elif continue_on:
        recommended = "continue"
    else:
        recommended = "none"
    return {
        "enabled": ai_on,
        "configured": ai_configured(settings),
        "cmsOverride": cms_override,
        "endpoint": endpoint if ai_on else "",
        "deployment": settings.azure_openai_deployment.strip() if ai_on else "",
        "deploymentConfigured": bool(settings.azure_openai_deployment.strip()),
        "dailyTokenLimit": limit,
        "usageToday": usage,
        "usageBlocked": blocked,
        "requireOrgGateway": bool(settings.noraops_ai_require_org_gateway),
        "policyVersion": "1",
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "features": {"copilot": copilot_on, "continue": continue_on},
        "copilotMinHostVersion": copilot_min,
        "minHostVersion": client_min,
        "recommendedProvider": recommended,
    }


async def probe_azure_openai(settings: Settings, runtime: AiRuntimeSettings | None = None) -> dict[str, Any]:
    ai_on = runtime.enabled if runtime else bool(settings.noraops_ai_enabled)
    if not ai_on:
        return {"ok": False, "reason": "disabled", "detail": "AI 中継が無効です"}
    if not ai_configured(settings):
        return {
            "ok": False,
            "reason": "not_configured",
            "detail": "AZURE_OPENAI_ENDPOINT / API_KEY / DEPLOYMENT を .env に設定してください",
        }

    endpoint = settings.azure_openai_endpoint.strip().rstrip("/")
    deployment = settings.azure_openai_deployment.strip()
    api_version = settings.azure_openai_api_version.strip() or "2024-02-15-preview"
    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"
    headers = {"api-key": settings.azure_openai_api_key.strip(), "Content-Type": "application/json"}
    body = {
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "temperature": 0,
    }

    try:
        async with create_async_client(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, json=body)
        if resp.status_code == 200:
            data = resp.json()
            usage = data.get("usage") or {}
            tin = int(usage.get("prompt_tokens", 0))
            tout = int(usage.get("completion_tokens", 0))
            record_usage(settings, tin, tout, source="probe")
            return {
                "ok": True,
                "detail": f"接続 OK（deployment: {deployment}）",
                "usage": {"tokens_in": tin, "tokens_out": tout},
            }
        return {
            "ok": False,
            "reason": "http_error",
            "detail": f"HTTP {resp.status_code}: {resp.text[:300]}",
        }
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout", "detail": "Azure OpenAI への接続がタイムアウトしました"}
    except Exception as e:
        return {"ok": False, "reason": "error", "detail": str(e)}


def usage_blocked(settings: Settings) -> tuple[bool, int, int]:
    usage = get_today_usage(settings)
    limit = max(0, int(settings.noraops_ai_daily_token_limit))
    total = usage["tokens_in"] + usage["tokens_out"]
    if limit <= 0:
        return False, total, limit
    return total >= limit, total, limit


def _day_cost_jpy(
    tokens_in: int, tokens_out: int, settings: Settings
) -> float:
    pin = max(0.0, float(settings.noraops_ai_jpy_per_1k_input))
    pout = max(0.0, float(settings.noraops_ai_jpy_per_1k_output))
    return (tokens_in / 1000.0) * pin + (tokens_out / 1000.0) * pout


def list_usage_summary(settings: Settings, days: int = 14) -> dict[str, Any]:
    path = _usage_path(settings)
    data = _load_usage(path)
    all_days = data.get("days", {})
    keys = sorted(all_days.keys(), reverse=True)[: max(1, days)]
    rows = []
    total_in = total_out = 0
    total_jpy = 0.0
    for k in reversed(keys):
        d = all_days.get(k, {})
        tin = int(d.get("tokens_in", 0))
        tout = int(d.get("tokens_out", 0))
        cost = _day_cost_jpy(tin, tout, settings)
        total_in += tin
        total_out += tout
        total_jpy += cost
        rows.append(
            {
                "date": k,
                "tokens_in": tin,
                "tokens_out": tout,
                "tokens_total": tin + tout,
                "cost_jpy": round(cost, 2),
            }
        )
    avg_daily_tokens = 0
    if rows:
        avg_daily_tokens = sum(r["tokens_total"] for r in rows) // len(rows)
    projected_monthly_jpy = round((total_jpy / max(len(rows), 1)) * 30, 0) if rows else 0.0
    today = get_today_usage(settings)
    today_jpy = round(_day_cost_jpy(today["tokens_in"], today["tokens_out"], settings), 2)
    return {
        "days": rows,
        "dailyTokenLimit": max(0, int(settings.noraops_ai_daily_token_limit)),
        "pricing": {
            "jpyPer1kInput": float(settings.noraops_ai_jpy_per_1k_input),
            "jpyPer1kOutput": float(settings.noraops_ai_jpy_per_1k_output),
            "note": ".env の NORAOPS_AI_JPY_PER_1K_* で Azure 単価に合わせて調整",
        },
        "totals": {
            "tokens_in": total_in,
            "tokens_out": total_out,
            "tokens_total": total_in + total_out,
            "cost_jpy": round(total_jpy, 2),
        },
        "today": {
            **today,
            "tokens_total": today["tokens_in"] + today["tokens_out"],
            "cost_jpy": today_jpy,
        },
        "averages": {
            "tokens_per_day": avg_daily_tokens,
            "cost_jpy_per_day": round(total_jpy / max(len(rows), 1), 2) if rows else 0.0,
        },
        "projectedMonthlyJpy": projected_monthly_jpy,
        "sources": _usage_source_breakdown(data.get("events") or []),
    }


def _usage_source_breakdown(events: list) -> list[dict[str, Any]]:
    by_src: dict[str, dict[str, int]] = {}
    for ev in events:
        src = str(ev.get("source") or "unknown")
        bucket = by_src.setdefault(src, {"tokens_in": 0, "tokens_out": 0, "count": 0})
        bucket["tokens_in"] += int(ev.get("tokens_in", 0))
        bucket["tokens_out"] += int(ev.get("tokens_out", 0))
        bucket["count"] += 1
    rows = []
    for src, v in sorted(by_src.items()):
        tin, tout = v["tokens_in"], v["tokens_out"]
        rows.append(
            {
                "source": src,
                "count": v["count"],
                "tokens_in": tin,
                "tokens_out": tout,
                "tokens_total": tin + tout,
            }
        )
    return rows


def list_usage_events(
    settings: Settings,
    *,
    limit: int = 200,
    source: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    path = _usage_path(settings)
    data = _load_usage(path)
    events = list(data.get("events") or [])
    events.reverse()
    if source:
        events = [e for e in events if str(e.get("source")) == source]
    if date_from:
        events = [e for e in events if str(e.get("date", "")) >= date_from]
    if date_to:
        events = [e for e in events if str(e.get("date", "")) <= date_to]
    lim = max(1, min(limit, 500))
    return {
        "events": events[:lim],
        "totalMatched": len(events),
        "filters": {"source": source, "date_from": date_from, "date_to": date_to, "limit": lim},
        "sources": _usage_source_breakdown(data.get("events") or []),
    }


def list_usage_by_repo(
    settings: Settings,
    *,
    app_id: str | None = None,
    repo_owner: str | None = None,
    repo_name: str | None = None,
    days: int = 30,
) -> dict[str, Any]:
    path = _usage_path(settings)
    data = _load_usage(path)
    events = list(data.get("events") or [])
    aid = (app_id or "").strip()
    owner = (repo_owner or "").strip()
    name = (repo_name or "").strip()
    filtered = []
    for ev in events:
        if aid and str(ev.get("app_id") or "") == aid:
            filtered.append(ev)
            continue
        if owner and name:
            if str(ev.get("repo_owner") or "") == owner and str(ev.get("repo_name") or "") == name:
                filtered.append(ev)
    if not filtered and (aid or (owner and name)):
        by_app = data.get("by_app") or {}
        for bucket in by_app.values():
            if aid and str(bucket.get("app_id") or "") == aid:
                tin = int(bucket.get("tokens_in", 0))
                tout = int(bucket.get("tokens_out", 0))
                return _repo_usage_payload(settings, aid, owner, name, tin, tout, [], days)
            if owner and name and str(bucket.get("repo_owner")) == owner and str(bucket.get("repo_name")) == name:
                tin = int(bucket.get("tokens_in", 0))
                tout = int(bucket.get("tokens_out", 0))
                return _repo_usage_payload(settings, aid, owner, name, tin, tout, [], days)
    tin = sum(int(e.get("tokens_in", 0)) for e in filtered)
    tout = sum(int(e.get("tokens_out", 0)) for e in filtered)
    return _repo_usage_payload(settings, aid, owner, name, tin, tout, filtered[-200:], days)


def _repo_usage_payload(
    settings: Settings,
    app_id: str,
    repo_owner: str,
    repo_name: str,
    tin: int,
    tout: int,
    events: list,
    days: int,
) -> dict[str, Any]:
    cost = round(_day_cost_jpy(tin, tout, settings), 2)
    label = f"{repo_owner}/{repo_name}" if repo_owner and repo_name else app_id or "—"
    return {
        "schema": "nora.ai-usage-repo/1",
        "app_id": app_id,
        "repo_owner": repo_owner,
        "repo_name": repo_name,
        "repo_label": label,
        "days": days,
        "tokens_in": tin,
        "tokens_out": tout,
        "tokens_total": tin + tout,
        "cost_jpy": cost,
        "events_count": len(events),
        "recent_events": list(reversed(events[-50:])),
        "pricing": {
            "jpyPer1kInput": float(settings.noraops_ai_jpy_per_1k_input),
            "jpyPer1kOutput": float(settings.noraops_ai_jpy_per_1k_output),
        },
    }


def usage_context_from_mapping(ctx: dict[str, str] | None) -> dict[str, str]:
    if not ctx:
        return {"app_id": "", "repo_owner": "", "repo_name": ""}
    return {
        "app_id": str(ctx.get("app_id") or ctx.get("appId") or "").strip(),
        "repo_owner": str(ctx.get("repo_owner") or ctx.get("repoOwner") or "").strip(),
        "repo_name": str(ctx.get("repo_name") or ctx.get("repoName") or "").strip(),
    }


async def chat_completion(
    settings: Settings,
    messages: list[dict[str, str]],
    *,
    max_tokens: int = 1024,
    temperature: float = 0.2,
    source: str = "chat",
    runtime: AiRuntimeSettings | None = None,
    usage_context: dict[str, str] | None = None,
) -> dict[str, Any]:
    blocked, total, limit = usage_blocked(settings)
    if blocked:
        return {
            "ok": False,
            "reason": "limit_exceeded",
            "detail": f"本日のトークン上限 ({limit}) に達しました（使用: {total}）",
            "statusCode": 429,
        }
    ai_on = runtime.enabled if runtime else bool(settings.noraops_ai_enabled)
    if not ai_on:
        return {"ok": False, "reason": "disabled", "detail": "AI 中継が無効です", "statusCode": 503}
    if not ai_configured(settings):
        return {
            "ok": False,
            "reason": "not_configured",
            "detail": "Azure OpenAI が未設定です",
            "statusCode": 503,
        }

    messages = enrich_messages_with_mcp(messages)
    endpoint = settings.azure_openai_endpoint.strip().rstrip("/")
    deployment = settings.azure_openai_deployment.strip()
    api_version = settings.azure_openai_api_version.strip() or "2024-02-15-preview"
    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"
    headers = {"api-key": settings.azure_openai_api_key.strip(), "Content-Type": "application/json"}
    safe_max = max(1, min(int(max_tokens), 4096))
    body = {
        "messages": messages,
        "max_tokens": safe_max,
        "temperature": float(temperature),
    }

    try:
        async with create_async_client(timeout=120.0) as client:
            resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            return {
                "ok": False,
                "reason": "http_error",
                "detail": f"HTTP {resp.status_code}: {resp.text[:500]}",
                "statusCode": resp.status_code,
            }
        data = resp.json()
        usage = data.get("usage") or {}
        tin = int(usage.get("prompt_tokens", 0))
        tout = int(usage.get("completion_tokens", 0))
        ctx = usage_context_from_mapping(usage_context)
        record_usage(
            settings,
            tin,
            tout,
            source=source,
            app_id=ctx["app_id"],
            repo_owner=ctx["repo_owner"],
            repo_name=ctx["repo_name"],
        )
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        content = msg.get("content") or ""
        return {
            "ok": True,
            "content": content,
            "model": deployment,
            "usage": {"tokens_in": tin, "tokens_out": tout},
            "usageToday": get_today_usage(settings),
        }
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout", "detail": "タイムアウト", "statusCode": 504}
    except Exception as e:
        return {"ok": False, "reason": "error", "detail": str(e), "statusCode": 500}


def build_openai_compat_response(
    deployment: str, content: str, tokens_in: int, tokens_out: int
) -> dict[str, Any]:
    now = int(time.time())
    return {
        "id": f"chatcmpl-noraops-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": now,
        "model": deployment,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": tokens_in,
            "completion_tokens": tokens_out,
            "total_tokens": tokens_in + tokens_out,
        },
    }


async def openai_proxy_chat(
    settings: Settings,
    body: dict[str, Any],
    *,
    runtime: AiRuntimeSettings | None = None,
    usage_context: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Continue 等 OpenAI 互換クライアント向け中継。"""
    raw_messages = body.get("messages") or []
    messages: list[dict[str, str]] = []
    for m in raw_messages:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "user")
        content = m.get("content")
        if isinstance(content, list):
            content = " ".join(
                str(p.get("text", p)) for p in content if isinstance(p, (dict, str))
            )
        if content is None:
            continue
        messages.append({"role": role, "content": str(content)})
    if not messages:
        return {"ok": False, "reason": "invalid_request", "detail": "messages が空です", "statusCode": 400}
    max_tokens = int(body.get("max_tokens") or body.get("max_completion_tokens") or 1024)
    temperature = float(body.get("temperature", 0.2))
    result = await chat_completion(
        settings,
        messages,
        max_tokens=max_tokens,
        temperature=temperature,
        source="proxy",
        runtime=runtime,
        usage_context=usage_context,
    )
    if not result.get("ok"):
        return result
    usage = result.get("usage") or {}
    return {
        "ok": True,
        "openai": build_openai_compat_response(
            str(result.get("model") or settings.azure_openai_deployment),
            str(result.get("content") or ""),
            int(usage.get("tokens_in", 0)),
            int(usage.get("tokens_out", 0)),
        ),
    }


def build_byok_client_config(
    settings: Settings, request: Any = None, runtime: AiRuntimeSettings | None = None
) -> dict[str, Any]:
    """
    拡張向け AI 設定。API キーは含めない。
    Continue は proxyApiBase + ダミー apiKey でサーバー中継を使う。
    """
    from app.core.root_path import public_base_url

    endpoint = settings.azure_openai_endpoint.strip().rstrip("/")
    deployment = settings.azure_openai_deployment.strip()
    api_version = settings.azure_openai_api_version.strip() or "2024-02-15-preview"
    public_base = public_base_url(request, settings).rstrip("/")
    proxy_base = f"{public_base}/api/v1/noraops/ai/proxy"
    vscode_settings: dict[str, Any] = {
        "github.copilot.enable": True,
        "github.copilot.chat.enable": True,
    }
    if endpoint:
        vscode_settings["github.copilot.chat.azureEndpoint"] = endpoint
    if deployment:
        vscode_settings["github.copilot.chat.azureDeployment"] = deployment
        vscode_settings["github.copilot.chat.azureModels"] = {
            deployment: {
                "name": deployment,
                "deployment": deployment,
                "endpoint": endpoint,
                "apiVersion": api_version,
            }
        }
    continue_model = {
        "title": "NoraOps Azure (org)",
        "provider": "openai",
        "model": deployment or "noraops",
        "apiBase": proxy_base,
        "apiKey": _PROXY_API_KEY,
    }
    ai_on = runtime.enabled if runtime else bool(settings.noraops_ai_enabled)
    return {
        "configured": ai_configured(settings),
        "enabled": ai_on,
        "endpoint": endpoint,
        "deployment": deployment,
        "apiVersion": api_version,
        "apiKeyIncluded": False,
        "relayMode": True,
        "proxyApiBase": proxy_base,
        "proxyApiKey": _PROXY_API_KEY,
        "proxyChatPath": "/v1/chat/completions",
        "continueModel": continue_model,
        "note": (
            "API キーはクライアントへ送りません。"
            " Continue は proxyApiBase + proxyApiKey（ダミー）で本サーバー中継を使います。"
            " Copilot BYOK の Azure キーは組織手順に従い VS Code 側で設定するか、"
            " POST /api/v1/noraops/ai/chat を利用してください。"
        ),
        "vscodeSettings": vscode_settings,
    }


def copilot_policy_bundle() -> dict[str, Any]:
    """拡張が Copilot 利用前に表示するポリシー。"""
    return {
        "schema": "noraops.copilot-policy/1",
        "rules": [
            {
                "id": "no_secrets_in_context",
                "severity": "error",
                "message": ".env / 鍵 / トークンを Copilot に渡さない。保存前にセキュリティチェックを通す。",
            },
            {
                "id": "org_gateway_only",
                "severity": "error",
                "message": "社内 FastAPI で有効な Azure OpenAI（BYOK）のみ使用。個人 GitHub Copilot 課金への切り替え禁止。",
            },
            {
                "id": "no_paste_secrets",
                "severity": "warn",
                "message": "プロンプトに GITEA_TOKEN や API キーを貼らない。",
            },
        ],
        "forbiddenPatterns": [".env", ".pem", "credentials", "gitea_pat_", "api_key", "password"],
        "byokSetupHint": [
            "GitHub Copilot 拡張がインストール済みであること",
            "VS Code 設定で GitHub Copilot のモデルを Azure OpenAI（BYOK）に向ける",
            "エンドポイント・API キー・デプロイ名は管理者が FastAPI .env で設定",
            "NoraOps の「Copilot 準備チェック」でサーバー接続を確認",
        ],
    }
