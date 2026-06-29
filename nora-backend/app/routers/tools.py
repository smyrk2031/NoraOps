import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.root_path import public_base_url
from app.services.tools_manifest_urls import rewrite_tool_download_urls
from app.db.models import DownloadLog
from app.db.session import get_session

router = APIRouter(prefix="/api/tools", tags=["tools"])


@router.get("/windows-x64/manifest.json")
async def windows_manifest(request: Request, settings: Settings = Depends(get_settings)) -> dict:
    manifest_path = settings.tools_manifest_abs_path
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="tools manifest not found")
    try:
        # PowerShell Set-Content -Encoding UTF8 may write a BOM; utf-8-sig accepts both.
        raw = manifest_path.read_text(encoding="utf-8-sig")
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"invalid tools manifest: {exc}") from exc
    # 127.0.0.1 を盘上から読んだだけではブラウザ経由ユーザーへ未到達 → Request で決める公開 URL に載せ替える
    return rewrite_tool_download_urls(data, public_base_url(request, settings))


@router.get("/files/{relative_path:path}")
async def tools_file(
    relative_path: str,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    base_dir = settings.tools_manifest_abs_path.parent.parent
    candidate = (base_dir / relative_path).resolve()
    base_resolved = base_dir.resolve()

    # Prevent directory traversal outside data/tools.
    try:
        candidate.relative_to(base_resolved)
    except ValueError as exc:
        db.add(
            DownloadLog(
                tool_name="unknown",
                version="unknown",
                filename=relative_path,
                status="bad_request",
                detail="invalid path traversal",
                ip=(request.client.host if request.client else ""),
                user_agent=request.headers.get("user-agent", ""),
            )
        )
        db.commit()
        raise HTTPException(status_code=400, detail="invalid path") from exc

    if not candidate.exists() or not candidate.is_file():
        db.add(
            DownloadLog(
                tool_name="unknown",
                version="unknown",
                filename=relative_path,
                status="not_found",
                detail="tool file does not exist",
                ip=(request.client.host if request.client else ""),
                user_agent=request.headers.get("user-agent", ""),
            )
        )
        db.commit()
        raise HTTPException(status_code=404, detail=f"tool file not found: {relative_path}")

    parts = Path(relative_path).parts
    tool_name = parts[0] if len(parts) >= 1 else "unknown"
    version = parts[1] if len(parts) >= 2 else "unknown"
    db.add(
        DownloadLog(
            tool_name=tool_name,
            version=version,
            filename=Path(relative_path).name,
            status="served",
            detail="ok",
            ip=(request.client.host if request.client else ""),
            user_agent=request.headers.get("user-agent", ""),
        )
    )
    db.commit()
    return FileResponse(Path(candidate))
