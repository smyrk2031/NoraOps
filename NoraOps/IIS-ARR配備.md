# IIS + ARR で NoraOps（NoraOps Server）をサブパス公開する

外部クライアント（VS Code 拡張・ブラウザ）は `http://{サーバー}/NoraOps` でアクセスします。  
uvicorn 上の FastAPI は内部では `/` ルートで動きますが、**`NORAOPS_ROOT_PATH` とミドルウェア**によりサブパス付き URL を生成・受信します。

## 動作の切り替え

| 環境 | `NORAOPS_ROOT_PATH` | アクセス例 |
|------|---------------------|------------|
| 開発（直起動） | 空 | `http://127.0.0.1:8000/` |
| IIS 本番 | `/NoraOps` | `http://intranet/NoraOps/` |

ローカル直起動の挙動は従来どおりです。本番用の env を入れずに開発できるようにしています。

## サーバー側の仕組み

1. **`RootPathMiddleware`**  
   着信パスが `/NoraOps/api/...` のとき内部ルーティング用に `/api/...` へ **path のみ**正規化します。  
   HTML リンク用 prefix は `NORAOPS_ROOT_PATH` / `X-Forwarded-Prefix` で別管理（ASGI `scope["root_path"]` には書き込みません。StaticFiles が壊れます）。

2. **テンプレート**  
   CSS・リンクは `{{ url('/static/...') }}` 形式。サブパスが自動付与されます。

3. **公開 API URL**  
   Runner カタログの `thumbnailUrl` などは `public_base_url()` で生成。  
   必要なら `.env` で明示:

   ```env
   NORAOPS_ROOT_PATH=/NoraOps
   NORAOPS_PUBLIC_BASE_URL=http://intranet/NoraOps
   ```

4. **ヘルス**  
   `GET /api/v1/portal/health`（拡張の接続テスト）に `rootPath` / `publicBaseUrl` を返します。

## IIS / ARR 設定（推奨パターン）

### パターン A: フルパスを uvicorn へ転送（推奨）

ブラウザ・拡張は `/NoraOps/...` のまま。ARR が **パスを変えず** `http://127.0.0.1:8000` にプロキシする場合:

- `.env`: `NORAOPS_ROOT_PATH=/NoraOps`
- ミドルウェアが `/NoraOps/api/health` → 内部 `/api/health` に変換

`web.config` 例（サイトまたはアプリ配下）:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="NoraOps ARR" stopProcessing="true">
          <match url="^NoraOps(.*)$" />
          <action type="Rewrite" url="http://127.0.0.1:8000/NoraOps{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PREFIX" value="/NoraOps" />
            <set name="HTTP_X_FORWARDED_PROTO" value="http" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

> `serverVariables` は ARR で「サーバー変数の許可」が必要です。  
> ヘッダが付けられない場合は `NORAOPS_ROOT_PATH` のみで十分です。

### パターン B: IIS でプレフィックスを剥がして転送

`/NoraOps/api/health` → バックエンドへ `/api/health` のみ送る場合:

- `.env`: `NORAOPS_ROOT_PATH=/NoraOps`（HTML リンク用に必須）
- 着信パスは既に `/api/...` なので strip は不要だが、`scope.root_path` は env から付与される

## uvicorn の起動例

```powershell
cd nora-backend
# .env に NORAOPS_ROOT_PATH=/NoraOps を設定（IIS 本番のみ）
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

IIS からのみ到達させるなら `--host 127.0.0.1` を推奨します。

## VS Code 拡張

「NoraOps 設定」タブのポータル URL に **ブラウザで開ける URL** を入力します（例 `http://intranet/NoraOps`）。  
末尾スラッシュは任意です。API は `{baseUrl}/api/v1/portal/health` へアクセスします。

## 確認チェックリスト

- [ ] `http://{IP}/NoraOps/` でトップが表示され、CSS が当たる（開発者ツールで `/NoraOps/static/styles.css` が 200）
- [ ] `http://{IP}/NoraOps/api/v1/portal/health` が JSON で `rootPath: "/NoraOps"`
- [ ] 拡張の接続テストが成功
- [ ] ローカル `http://127.0.0.1:8000/` は `NORAOPS_ROOT_PATH` 空で従来どおり

## トラブルシュート

| 症状 | 原因の例 |
|------|----------|
| HTML は出るが CSS なし | `NORAOPS_ROOT_PATH` 未設定、または uvicorn 再起動忘れ。プロキシが `/NoraOps/static/*` を `:8000` に転送しているか確認 |
| API 404 | ARR のリライト先が `/api` ではなく `/NoraOps/api` と二重、または strip 不整合 |
| 拡張だけ失敗 | `noraops.server.baseUrl` が `http://IP` のみで `/NoraOps` が欠けている |
| サムネ URL が localhost | `NORAOPS_PUBLIC_BASE_URL` を本番 URL に設定 |

関連: [サーバー接続設定.md](./サーバー接続設定.md)、[接続の堅健性チェック.md](./接続の堅健性チェック.md)
