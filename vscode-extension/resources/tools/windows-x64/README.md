# オフライン用 uv.exe（同梱）

拡張に `uv.exe` を同梱すると、サーバーなしでも Runner / Creator の Python 環境構築が動きます。

## 配置場所

```
vscode-extension/resources/tools/windows-x64/uv.exe
```

## 同梱手順（開発・ビルド前）

PowerShell（リポジトリルート）:

```powershell
.\vscode-extension\scripts\stage-bundled-uv.ps1
```

または手動で `nora-backend\data\tools\uv\0.6.0\uv.exe` などを上記パスにコピー。

## 動作

- `noraops.tools.useBundledUv`（既定 ON）で同梱 uv を優先
- 初回は `%LOCALAPPDATA%\NoraOps\runtime\tools\uv\uv.exe` へコピー
- サーバー manifest からの更新はオンライン時のみ（同梱が無い場合のフォールバック）

## サイズ

uv.exe は約 65MB です。VSIX が大きくなりますが、閉域・オフライン向けの意図的なトレードオフです。
