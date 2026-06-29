# Tool Layout and Version Rules

## Install Root
- Default: `%LOCALAPPDATA%\\PyGardenRuntime`
- Override: `pygarden.tools.installRoot`

## Directory Layout
```
PyGardenRuntime/
  tools/
    uv/
      uv.exe
    portable-git/
      cmd/git.exe
      ...
    tool-state.json
    .staging/
  cache/
    uv-<version>.exe
    portable-git-<version>.zip
  logs/
```

## Version Management
- State file keeps installed versions and channel.
- Re-download is triggered when:
  - target binary does not exist
  - state version != manifest version
  - force-minimum policy requires upgrade

## Safe Update Rule
- Install into `.staging/<tool>-<timestamp>` first.
- Replace current directory by rename.
- Keep backup (`.bak`) and rollback on failure.

## Cleanup Rule
- Keep latest 2 cache artifacts per tool.
- Remove artifacts not used in the last 30 days.
- Keep logs for 14 days.
