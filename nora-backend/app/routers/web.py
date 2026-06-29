from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.root_path import join_root_path, resolve_request_root_path
from app.core.template_ctx import render_template
from app.db.session import get_session
from app.services.admin_config_service import AdminConfigService
from app.services.analyzer import RepoAnalyzer
from app.services.gitea_client import GiteaClient

router = APIRouter(tags=["web"])


@router.get("/", response_class=HTMLResponse)
async def top_page(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    download = settings.client_download_url
    if download.startswith("/"):
        root = resolve_request_root_path(request, settings)
        download = join_root_path(root, download)
    return render_template(
        request=request,
        name="index.html",
        context={
            "download_url": download,
            "gitea_url": cfg.gitea_base_url or "#",
        },
    )


@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    cfg = AdminConfigService(db).resolve_runtime_config(settings)
    repos = await GiteaClient(cfg).list_org_repos()
    analyzer = RepoAnalyzer()
    apps = analyzer.app_catalog(repos)[:15]
    knowledge = analyzer.knowledge_insights(repos)[:5]
    workflows = analyzer.workflow_insights(repos)
    violations = analyzer.policy_violations(repos)[:30]
    has_token = bool((cfg.gitea_token or "").strip())
    zero_hint = None
    if len(repos) == 0 and (cfg.gitea_base_url or "").strip():
        if not has_token:
            zero_hint = (
                "Gitea API 用の PAT（GITEA_TOKEN）が未設定です。リポジトリが非公開の場合、"
                "検索結果に出ず総数 0 になります。管理者アカウントでトークンを発行し .env に設定するか、"
                "リポジトリを公開にしてください。Organization にリポが無くても、ユーザー直下のリポは "
                "トークンがあれば一覧されます。"
            )
        else:
            zero_hint = (
                "トークンはありますが 0 件です。GITEA_BASE_URL が実際の Gitea と一致しているか、"
                "トークンに api / read:repository 等のスコープがあるか確認してください。"
            )
    return render_template(
        request=request,
        name="dashboard.html",
        context={
            "apps": apps,
            "knowledge": knowledge,
            "workflows": workflows,
            "violations": violations,
            "total_repos": len(repos),
            "zero_repo_hint": zero_hint,
        },
    )
