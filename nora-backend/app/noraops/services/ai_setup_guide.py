"""セキュア AI セットアップ手順 — 拡張自動設定 + 手動コピペ用スニペット。"""

from __future__ import annotations

import json
from typing import Any

from app.core.config import Settings
from app.core.root_path import public_base_url
from app.noraops.services.ai_gateway import build_byok_client_config
from app.noraops.services.ai_runtime_settings import AiRuntimeSettings, resolve_ai_runtime


def build_setup_guide(
    settings: Settings,
    request: Any = None,
    runtime: AiRuntimeSettings | None = None,
) -> dict[str, Any]:
    base = public_base_url(request, settings).rstrip("/")
    byok = build_byok_client_config(settings, request, runtime)
    deployment = settings.azure_openai_deployment.strip() or "your-deployment"
    endpoint = settings.azure_openai_endpoint.strip().rstrip("/")
    proxy_base = byok.get("proxyApiBase") or f"{base}/api/v1/noraops/ai/proxy"
    continue_model = dict(byok.get("continueModel") or {})
    if not continue_model.get("requestOptions"):
        continue_model["requestOptions"] = {
            "headers": {
                "X-NoraOps-App-Id": "{{ manifest の appId }}",
                "X-NoraOps-Repo-Owner": "{{ Gitea owner }}",
                "X-NoraOps-Repo-Name": "{{ リポジトリ名 }}",
            }
        }
    continue_file = {
        "models": [continue_model],
        "defaultModel": continue_model.get("title") or "NoraOps Azure (org)",
    }
    vscode_settings = dict(byok.get("vscodeSettings") or {})
    settings_snippet = json.dumps(vscode_settings, ensure_ascii=False, indent=2)

    relay = bool(byok.get("relayMode"))
    recommended = "continue" if relay and (runtime is None or runtime.continue_enabled) else "copilot"

    return {
        "schema": "nora.ai-setup-guide/1",
        "helpUrl": f"{base}/help?t=secure-ai",
        "serverBaseUrl": base,
        "recommended": recommended,
        "relayMode": relay,
        "autoSetup": {
            "continue": {
                "supported": True,
                "summary": "Continue 拡張のインストール + ワークスpace/.continue/config.json を自動作成（API キー不要・サーバー中継）",
            },
            "copilot": {
                "supported": True,
                "partial": True,
                "summary": "Copilot 拡張のインストール + settings.json に endpoint/deployment を自動反映。Azure API キーは VS Code 側で組織手順に従い手動入力",
            },
        },
        "continue": {
            "targetFile": ".continue/config.json",
            "locationHint": "ワークスペース直下（例: my-app/.continue/config.json）",
            "configJson": continue_file,
            "configText": json.dumps(continue_file, ensure_ascii=False, indent=2),
            "steps": [
                "Continue 拡張（Continue.continue）をインストール",
                f"`.continue/config.json` に下記 JSON を保存（拡張の「セキュア AI」ボタンで自動作成可）",
                "Continue サイドバーでモデル「NoraOps Azure (org)」を選択",
                f"apiKey は `{byok.get('proxyApiKey', 'noraops-proxy')}` のまま（ダミー）。通信は {proxy_base} 経由",
            ],
        },
        "copilot": {
            "targetFile": "VS Code settings.json（ユーザーまたはワークスペース）",
            "settingsJson": vscode_settings,
            "settingsText": settings_snippet,
            "steps": [
                "GitHub Copilot + GitHub Copilot Chat 拡張をインストール",
                "VS Code 1.122.0 以上（BYOK 対応版）",
                "設定 JSON に下記を追記（拡張の BYOK 反映コマンドでも自動投入可）",
                "GitHub Copilot の Azure OpenAI 設定で API キーを組織手順に従って入力（サーバーからは配信しません）",
                "チャットを開き、NoraOps からコピーしたプロンプトを貼り付け",
            ],
        },
        "envAdmin": {
            "note": "管理者: Azure キーは .env のみ。ON/OFF は CMS → AI 中継。",
            "vars": [
                "AZURE_OPENAI_ENDPOINT",
                "AZURE_OPENAI_API_KEY",
                "AZURE_OPENAI_DEPLOYMENT",
            ],
            "endpointSample": endpoint or "https://YOUR-RESOURCE.openai.azure.com",
            "deploymentSample": deployment,
        },
    }
