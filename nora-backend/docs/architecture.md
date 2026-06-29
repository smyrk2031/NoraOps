# Architecture (Extensible Baseline)

## Layers
- `app/routers`: HTTP entrypoints (web/api/admin/tools)
- `app/services`: business logic (gitea integration, analysis, admin config)
- `app/db`: persistence models/session/bootstrap
- `app/schemas`: API response/input schemas

## Current Persistence
- `app_config`: runtime admin settings (incl. optional `mcp_bridge_api_key`)
- `api_access_logs`: request logs
- `download_logs`: tool download logs
- `telemetry_events`: VS Code / CLI telemetry buffers
- `mcp_audit_logs`: HTTP MCP bridge history

## Implemented feature modules
- `services/catalog_service.py`: shape Gitea repo payloads for `/api/catalog/apps`
- `services/recommendation_service.py`: placeholder keyword ranker for `/api/catalog/recommend`
- `routers/catalog.py`, `routers/telemetry.py`, `routers/mcp.py`
- `services/mcp_bridge_service.py`: safe tool execution + audit trail

## Why this split
- Recommendation engine, MCP features, and extension telemetry can be added as new service modules without coupling router logic.
- DB models are centralized; routers call services; services can be tested in isolation.

## Planned Extension Points
- embeddings / semantic search for catalog
- richer telemetry schema + batching
- background jobs for periodic Gitea sync
