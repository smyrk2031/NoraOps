# Tool Distribution API Spec (Windows)

## Endpoint
- `GET /api/tools/windows-x64/manifest.json`
- `Authorization: Bearer <token>` (optional by environment)

## Response Schema
```json
{
  "manifestVersion": "1",
  "channel": "stable",
  "generatedAt": "2026-05-07T12:00:00.000Z",
  "policy": {
    "forceMinimumUvVersion": "0.5.0",
    "forceMinimumGitVersion": "2.47.0"
  },
  "uv": {
    "version": "0.6.3",
    "url": "https://tools.example.local/artifacts/uv/0.6.3/uv.exe",
    "sha256": "2f5a2d...abc",
    "size": 14562312
  },
  "portableGit": {
    "version": "2.48.1",
    "url": "https://tools.example.local/artifacts/git/2.48.1/portable-git.zip",
    "sha256": "de13ad...987",
    "size": 65432109
  }
}
```

## Validation Rules
- `uv` and `portableGit` are required.
- `url` must be HTTPS in production.
- `sha256` must be lowercase 64 hex characters.
- `version` must follow `major.minor.patch`.
- `policy.forceMinimum*` can be omitted for soft updates.

## Error Contract
- `401/403`: token invalid or expired.
- `404`: channel or platform manifest not found.
- `5xx`: retriable server issue.

## Operational Notes
- Keep channel-specific manifests (`stable`, `canary`) to support staged rollout.
- Publish artifact and manifest atomically to prevent broken references.
