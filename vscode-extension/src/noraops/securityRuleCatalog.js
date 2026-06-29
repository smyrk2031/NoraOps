/** セキュリティガード UI 用ラベル・サンプル（vscode 非依存） */

const RULE_LABELS = {
  "sec.ip_literal": { title: "IPアドレス", desc: "IPv4/IPv6 直書き検出（ユーザー救済ホワイトリスト対応）" },
  "sec.password_assignment": { title: "パスワード", desc: "password / passwd の直書き" },
  "sec.secret_credential": { title: "APIキー", desc: "api_key / client_secret / private_key 等" },
  "sec.token_assignment": { title: "トークン", desc: "access_token / Bearer 等" },
  "sec.account_literal": { title: "アカウント名", desc: "username / account 等の固定文字列" },
  "sec.email_literal": { title: "個人情報（メール）", desc: "メールアドレスの直書き" },
  "sec.digit7_id": { title: "ID（7桁）", desc: "employee_id 等に紐づく 7 桁 ID" },
  "sec.gitea_pat_prefix": { title: "Gitea PAT", desc: "gitea_pat_ で始まるトークン" },
};

const RULE_SAMPLES = {
  "sec.ip_literal": 'DB_HOST = "192.168.10.25"',
  "sec.password_assignment": 'password = "MySecret123"',
  "sec.secret_credential": 'api_key = "sk-live-abcdef123456"',
  "sec.token_assignment": 'access_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"',
  "sec.account_literal": 'username = "tanaka.taro"',
  "sec.email_literal": "contact = tanaka@example.co.jp",
  "sec.digit7_id": 'employee_id = "1234567"',
  "sec.gitea_pat_prefix": "gitea_pat_abcdefghijklmnopqrst",
};

const RULE_NG_EXAMPLES = {
  "sec.ip_literal": [
    'DB_HOST = "192.168.10.25"',
    'API_URL = "http://172.16.3.4/v1"',
    'SERVER = "203.0.113.50"',
    'dns = "8.8.4.4"',
    'redis_host = "169.254.169.254"',
  ],
  "sec.password_assignment": [
    'password = "MySecret123"',
    'passwd: "admin2024"',
    "pwd = 'local_only'",
    'DB_PASSWORD = "hunter2"',
    'login_password = "abc12345"',
  ],
  "sec.secret_credential": [
    'api_key = "sk-live-abcdef123456"',
    'client_secret = "GOCSPX-xxxxxxxxxxxx"',
    'private_key = "-----BEGIN RSA PRIVATE KEY-----"',
    'secret_key = "prod-webhook-signing-key"',
    'API_KEY: "AKIAIOSFODNN7EXAMPLE"',
  ],
  "sec.token_assignment": [
    'access_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"',
    'refresh_token = "rt_abcdefghijklmnopqrstuvwxyz"',
    'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
    'authorization: "Bearer ghp_xxxxxxxxxxxxxxxxxxxx"',
    'bearer = "oauth2-static-token-value"',
  ],
  "sec.account_literal": [
    'username = "tanaka.taro"',
    'user_name: "yamada.hanako"',
    'account = "svc_batch_runner"',
    'login_id = "admin01"',
    'user_id = "U00042"',
  ],
  "sec.email_literal": [
    "contact = tanaka@example.co.jp",
    'notify_to = "ops-team@company.local"',
    "owner: admin@myorg.example.com",
    'FROM_ADDR = "no-reply@service.jp"',
    "support = helpdesk+prod@example.org",
  ],
  "sec.digit7_id": [
    'employee_id = "1234567"',
    'staff_id: "7654321"',
    'personal_id = 9876543',
    '社員番号 = "1000001"',
    'employee_no: "2000123"',
  ],
  "sec.gitea_pat_prefix": [
    "gitea_pat_abcdefghijklmnopqrst",
    "gitea_pat_0123456789abcdefghij",
    'token = "gitea_pat_zzzzzzzzzzzzzzzzzzzz"',
    "Authorization: gitea_pat_aaaaaaaaaaaaaaaaaaaa",
    "GIT_TOKEN=gitea_pat_bbbbbbbbbbbbbbbbbbbb",
  ],
};

module.exports = {
  RULE_LABELS,
  RULE_SAMPLES,
  RULE_NG_EXAMPLES,
};
