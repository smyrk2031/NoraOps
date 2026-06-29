# 生成 AI 連携構想

## 目的

- **フロント**: VS Code + GitHub Copilot（BYOK）で開発
- **バックエンド**: Azure OpenAI 等への **踏み台** — トークン計測・上限・ダッシュボード
- **拡張**: 利用状況を逐次表示（使えない時間帯の通知）

## 実装状況（2026-05）

| 項目 | 状態 |
|------|------|
| FastAPI `NORAOPS_AI_*` 設定 | ✅ |
| `GET /api/v1/noraops/ai/status` | ✅ |
| `GET /api/v1/noraops/ai/probe` | ✅ |
| `GET /api/v1/noraops/ai/copilot-policy` | ✅ |
| `POST /api/v1/noraops/ai/chat` | ✅ Phase 2（プロキシ・トークン記録） |
| `GET /api/v1/noraops/ai/usage` | ✅ 日別 JSON |
| 日次上限 → HTTP 429 | ✅ `NORAOPS_AI_DAILY_TOKEN_LIMIT` |
| 管理 HTML `/noraops/ai-usage` | ✅ |
| 拡張 Copilot 準備チェック | ✅ v0.8.3+ |
| 拡張ステータスバー使用量 | ❌ Phase 3 |

手順: [Copilot-BYOK連携.md](./Copilot-BYOK連携.md)

## chat API 例

```http
POST /api/v1/noraops/ai/chat
Content-Type: application/json

{
  "messages": [{"role": "user", "content": "hello"}],
  "max_tokens": 512,
  "temperature": 0.2
}
```

上限超過時は **429** と `detail` が返ります。

## フェーズ

| Phase | 内容 | 状態 |
|-------|------|------|
| P0 | security チェックで秘密情報抑止 | ✅ |
| P1 | status / probe / 拡張準備チェック | ✅ |
| P2 | chat プロキシ + 上限 + ダッシュボード | ✅ |
| P3 | 拡張 UI 連続表示・上限接近通知 | 未 |

## 関連

- [Copilot-BYOK連携.md](./Copilot-BYOK連携.md)
- [ポリシーチェックルール.md](./ポリシーチェックルール.md)
