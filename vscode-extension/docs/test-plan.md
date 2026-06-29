# Test Plan

## Unit（`npm test`）

- `compareSemver` ordering.
- `sha256File` integrity calculation.
- `validateReleaseReadiness` — 公開前チェック（README / pyproject / manifest）。
- `describePublishFailureDetail` — 保存 OK / 公開 NG のメッセージ。

## Integration (manual)
1. Clear `%LOCALAPPDATA%\\PyGardenRuntime`.
2. Start extension with valid manifest URL/token.
3. Confirm setup reaches done state.
4. Corrupt manifest SHA and confirm install is blocked.
5. Disconnect network and verify error + retry path.

## End-to-End (manual)
1. Fresh machine and fresh VS Code profile.
2. Install extension only.
3. Open project with `manifest.json`.
4. Run `PyGarden: Run from Manifest`.
5. Confirm `uv` run executes without any external tool install.
