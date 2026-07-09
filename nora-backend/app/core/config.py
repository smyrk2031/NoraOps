from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    env: str = Field(default="dev", alias="SOFTRAIL_ENV")
    host: str = Field(default="127.0.0.1", alias="SOFTRAIL_HOST")
    port: int = Field(default=8000, alias="SOFTRAIL_PORT")
    log_level: str = Field(default="INFO", alias="SOFTRAIL_LOG_LEVEL")

    client_download_url: str = Field(
        default="https://example.com/softrail-extension.vsix",
        alias="SOFTRAIL_CLIENT_DOWNLOAD_URL",
    )
    noraops_published_topic: str = Field(default="nora-published", alias="NORAOPS_PUBLISHED_TOPIC")
    noraops_catalog_dev_show_all: bool = Field(default=False, alias="NORAOPS_CATALOG_DEV_SHOW_ALL")
    # dev では拡張が GET /api/v1/noraops/client/runtime-config で Gitea 接続情報を取得できる
    noraops_client_expose_gitea_token: bool | None = Field(
        default=None, alias="NORAOPS_CLIENT_EXPOSE_GITEA_TOKEN"
    )
    noraops_push_session_ttl_minutes: int = Field(default=15, alias="NORAOPS_PUSH_SESSION_TTL_MINUTES")
    noraops_push_max_bundle_mb: int = Field(default=100, alias="NORAOPS_PUSH_MAX_BUNDLE_MB")
    noraops_save_max_zip_mb: int = Field(default=50, alias="NORAOPS_SAVE_MAX_ZIP_MB")
    # 通常保存（下書き）: force push 先。公開版 main の履歴は触らない。
    noraops_save_draft_branch: str = Field(default="noraops-draft", alias="NORAOPS_SAVE_DRAFT_BRANCH")
    # 公開リリース: 履歴を積む正式ブランチ（force push しない）。
    noraops_save_publish_branch: str = Field(default="main", alias="NORAOPS_SAVE_PUBLISH_BRANCH")
    noraops_artifacts_dir: str = Field(default="./data/noraops/artifacts", alias="NORAOPS_ARTIFACTS_DIR")

    # Azure OpenAI 踏み台（Copilot BYOK 用・既定 OFF）
    noraops_ai_enabled: bool = Field(default=False, alias="NORAOPS_AI_ENABLED")
    azure_openai_endpoint: str = Field(default="", alias="AZURE_OPENAI_ENDPOINT")
    azure_openai_api_key: str = Field(default="", alias="AZURE_OPENAI_API_KEY")
    azure_openai_deployment: str = Field(default="", alias="AZURE_OPENAI_DEPLOYMENT")
    azure_openai_api_version: str = Field(
        default="2024-02-15-preview", alias="AZURE_OPENAI_API_VERSION"
    )
    noraops_ai_daily_token_limit: int = Field(default=0, alias="NORAOPS_AI_DAILY_TOKEN_LIMIT")
    # 利用量ダッシュボードの円換算（1K トークンあたりの円・Azure 請求に合わせて調整）
    noraops_ai_jpy_per_1k_input: float = Field(default=0.5, alias="NORAOPS_AI_JPY_PER_1K_INPUT")
    noraops_ai_jpy_per_1k_output: float = Field(default=1.5, alias="NORAOPS_AI_JPY_PER_1K_OUTPUT")
    noraops_ai_require_org_gateway: bool = Field(
        default=True, alias="NORAOPS_AI_REQUIRE_ORG_GATEWAY"
    )
    noraops_copilot_enabled: bool = Field(default=True, alias="NORAOPS_COPILOT_ENABLED")
    noraops_continue_enabled: bool = Field(default=True, alias="NORAOPS_CONTINUE_ENABLED")
    noraops_copilot_min_host_version: str = Field(
        default="1.122.0", alias="NORAOPS_COPILOT_MIN_HOST_VERSION"
    )
    noraops_client_min_host_version: str = Field(
        default="1.88.0", alias="NORAOPS_CLIENT_MIN_HOST_VERSION"
    )
    # 1 のときのみ httpx が HTTP_PROXY 等を参照（外向き専用プロキシ必須の組織向け）
    noraops_http_trust_env: bool = Field(default=False, alias="NORAOPS_HTTP_TRUST_ENV")
    # IIS/ARR サブパス（例 /NoraOps）。空=ローカル直起動。HTML/API 公開パスに付与。
    noraops_root_path: str = Field(default="", alias="NORAOPS_ROOT_PATH")
    # 外向き URL 明示（例 https://intranet/NoraOps）。未設定時は Host + root_path から推定。
    noraops_public_base_url: str = Field(default="", alias="NORAOPS_PUBLIC_BASE_URL")
    # ヘルプ MD のルート（未設定時はリポジトリ直下の NoraOps/）
    noraops_docs_dir: str = Field(default="", alias="NORAOPS_DOCS_DIR")
    tools_manifest_path: str = Field(
        default="./data/tools/windows-x64/manifest.json",
        alias="SOFTRAIL_TOOLS_MANIFEST_PATH",
    )
    # 起動時に data/ が空なら app/bootstrap_data から復元
    noraops_data_bootstrap: bool = Field(default=True, alias="NORAOPS_DATA_BOOTSTRAP")

    # 自動バックアップ（Gitea + バックエンド data/）
    noraops_backup_enabled: bool = Field(default=True, alias="NORAOPS_BACKUP_ENABLED")
    noraops_backup_interval_hours: int = Field(default=24, alias="NORAOPS_BACKUP_INTERVAL_HOURS")
    noraops_backup_retention: int = Field(default=3, alias="NORAOPS_BACKUP_RETENTION")
    noraops_backup_local_dir: str = Field(default="./data/backups", alias="NORAOPS_BACKUP_LOCAL_DIR")
    noraops_backup_remote_dir: str = Field(default="", alias="NORAOPS_BACKUP_REMOTE_DIR")
    noraops_backup_include_artifacts: bool = Field(default=False, alias="NORAOPS_BACKUP_INCLUDE_ARTIFACTS")
    noraops_backup_include_tools: bool = Field(default=False, alias="NORAOPS_BACKUP_INCLUDE_TOOLS")
    # 設定時はバックアップ ZIP を AES 暗号化（復元も同一パスワードが必要）
    noraops_backup_zip_password: str = Field(default="", alias="NORAOPS_BACKUP_ZIP_PASSWORD")

    # PyPI ミラー（pypiserver + ARR）。空=社内 index 未設定（拡張は PyPI 直）
    noraops_pypi_index_url: str = Field(default="", alias="NORAOPS_PYPI_INDEX_URL")
    noraops_pypi_fallback_enabled: bool = Field(default=True, alias="NORAOPS_PYPI_FALLBACK_ENABLED")
    noraops_pypi_mirror_dir: str = Field(default="./data/noraops/packages/mirror", alias="NORAOPS_PYPI_MIRROR_DIR")
    noraops_pypi_mirror_archive_dir: str = Field(
        default="./data/noraops/packages/mirror-archive",
        alias="NORAOPS_PYPI_MIRROR_ARCHIVE_DIR",
    )

    # リポジトリ監査（拡張 checkRunner を Node CLI 経由で実行）
    noraops_repo_audit_enabled: bool = Field(default=True, alias="NORAOPS_REPO_AUDIT_ENABLED")
    noraops_repo_audit_on_save: bool = Field(default=True, alias="NORAOPS_REPO_AUDIT_ON_SAVE")
    noraops_repo_audit_nightly: bool = Field(default=True, alias="NORAOPS_REPO_AUDIT_NIGHTLY")
    noraops_repo_audit_hour: int = Field(default=23, alias="NORAOPS_REPO_AUDIT_HOUR")
    noraops_repo_audit_minute: int = Field(default=30, alias="NORAOPS_REPO_AUDIT_MINUTE")
    noraops_extension_dir: str = Field(default="", alias="NORAOPS_EXTENSION_DIR")
    # 監査 CLI 用 Node（PATH 不要）。未設定時は data/tools/node/<version>/ を参照
    noraops_node_exe: str = Field(default="", alias="NORAOPS_NODE_EXE")
    noraops_node_dir: str = Field(default="", alias="NORAOPS_NODE_DIR")
    noraops_node_version: str = Field(default="22.12.0", alias="NORAOPS_NODE_VERSION")

    # 管理画面 Basic 認証（両方設定時のみ /admin と /api/admin を保護）
    noraops_admin_basic_user: str = Field(default="", alias="NORAOPS_ADMIN_BASIC_USER")
    noraops_admin_basic_password: str = Field(default="", alias="NORAOPS_ADMIN_BASIC_PASSWORD")
    # 管理画面からメールなし手動ユーザを作成（0=無効・本番デフォルト）
    noraops_admin_manual_provision: bool = Field(default=False, alias="NORAOPS_ADMIN_MANUAL_PROVISION")

    # 認証: open（開発）| email_token（本番推奨）| windows_trust（レガシー）| email_otp（レガシー）
    noraops_auth_mode: str = Field(default="open", alias="NORAOPS_AUTH_MODE")
    noraops_trusted_user_header: str = Field(default="X-Remote-User", alias="NORAOPS_TRUSTED_USER_HEADER")
    noraops_trusted_email_header: str = Field(default="X-Remote-Email", alias="NORAOPS_TRUSTED_EMAIL_HEADER")
    noraops_gitea_auto_provision: bool = Field(default=True, alias="NORAOPS_GITEA_AUTO_PROVISION")
    noraops_gitea_email_domain: str = Field(default="noreply.local", alias="NORAOPS_GITEA_EMAIL_DOMAIN")
    noraops_user_token_secret: str = Field(default="dev-only-change-me", alias="NORAOPS_USER_TOKEN_SECRET")

    # email_otp モード
    noraops_smtp_host: str = Field(default="", alias="NORAOPS_SMTP_HOST")
    noraops_smtp_port: int = Field(default=587, alias="NORAOPS_SMTP_PORT")
    noraops_smtp_user: str = Field(default="", alias="NORAOPS_SMTP_USER")
    noraops_smtp_password: str = Field(default="", alias="NORAOPS_SMTP_PASSWORD")
    noraops_smtp_from: str = Field(default="", alias="NORAOPS_SMTP_FROM")
    noraops_smtp_use_tls: bool = Field(default=True, alias="NORAOPS_SMTP_USE_TLS")
    noraops_otp_ttl_minutes: int = Field(default=10, alias="NORAOPS_OTP_TTL_MINUTES")
    noraops_session_idle_days: int = Field(default=7, alias="NORAOPS_SESSION_IDLE_DAYS")
    noraops_session_absolute_days: int = Field(default=30, alias="NORAOPS_SESSION_ABSOLUTE_DAYS")

    # メール送信: smtp | http（自社メール API）
    noraops_mail_provider: str = Field(default="smtp", alias="NORAOPS_MAIL_PROVIDER")
    noraops_mail_http_url: str = Field(default="", alias="NORAOPS_MAIL_HTTP_URL")
    noraops_mail_http_api_key: str = Field(default="", alias="NORAOPS_MAIL_HTTP_API_KEY")
    noraops_activation_ttl_hours: int = Field(default=24, alias="NORAOPS_ACTIVATION_TTL_HOURS")
    # email_token: 仮登録（メール未確認）の保持時間
    noraops_pending_registration_hours: int = Field(default=12, alias="NORAOPS_PENDING_REGISTRATION_HOURS")
    # email_token: アクセストークン有効日数（0=無期限）
    noraops_access_token_days: int = Field(default=0, alias="NORAOPS_ACCESS_TOKEN_DAYS")
    # email_token: 許可メールドメイン（カンマ区切り、空=制限なし）
    noraops_allowed_email_domains: str = Field(default="", alias="NORAOPS_ALLOWED_EMAIL_DOMAINS")
    # windows_trust: メール有効化完了まで Gitea 自動作成しない（1=推奨）
    noraops_require_email_activation: bool = Field(default=True, alias="NORAOPS_REQUIRE_EMAIL_ACTIVATION")

    gitea_base_url: str = Field(default="", alias="GITEA_BASE_URL")
    gitea_token: str = Field(default="", alias="GITEA_TOKEN")
    gitea_orgs: str = Field(default="", alias="GITEA_ORGS")
    # scoped=GITEA_ORGS のみ（空なら user/repos）。all_orgs=管理者 API で全 Organization 列挙。instance=repos/search でインスタンス横断（管理者トークンなら実質全体）。
    gitea_list_mode: str = Field(default="instance", alias="GITEA_LIST_MODE")
    gitea_default_per_page: int = Field(default=50, alias="GITEA_DEFAULT_PER_PAGE")
    db_backend: str = Field(default="sqlite", alias="SOFTRAIL_DB_BACKEND")
    db_url: str = Field(default="", alias="SOFTRAIL_DB_URL")
    sqlite_path: str = Field(default="./data/softrail.db", alias="SOFTRAIL_SQLITE_PATH")

    @property
    def gitea_org_list(self) -> list[str]:
        return [org.strip() for org in self.gitea_orgs.split(",") if org.strip()]

    @property
    def tools_manifest_abs_path(self) -> Path:
        return Path(self.tools_manifest_path).resolve()

    @property
    def sqlite_abs_path(self) -> Path:
        return Path(self.sqlite_path).resolve()

    @property
    def expose_gitea_token_to_client(self) -> bool:
        """PAT を拡張へ渡すか。既定 OFF（push はサーバー経由）。"""
        if self.noraops_client_expose_gitea_token is not None:
            return self.noraops_client_expose_gitea_token
        return False

    @property
    def push_max_bundle_bytes(self) -> int:
        mb = max(1, int(self.noraops_push_max_bundle_mb))
        return mb * 1024 * 1024

    @property
    def save_max_zip_bytes(self) -> int:
        mb = max(1, int(self.noraops_save_max_zip_mb))
        return mb * 1024 * 1024

    @property
    def artifacts_abs_dir(self) -> Path:
        return Path(self.noraops_artifacts_dir).resolve()

    @property
    def pypi_mirror_abs_dir(self) -> Path:
        return Path(self.noraops_pypi_mirror_dir).resolve()

    @property
    def pypi_mirror_archive_abs_dir(self) -> Path:
        return Path(self.noraops_pypi_mirror_archive_dir).resolve()

    @property
    def extension_abs_dir(self) -> Path:
        if (self.noraops_extension_dir or "").strip():
            return Path(self.noraops_extension_dir).resolve()
        server_root = Path(__file__).resolve().parents[2]
        for rel in ("vendor/vscode-extension", "extensions/vscode-extension"):
            cand = (server_root / rel).resolve()
            if (cand / "scripts" / "repo-audit-cli.js").is_file():
                return cand
        # 開発: nora-backend と vscode-extension が兄弟
        return (server_root.parent / "vscode-extension").resolve()

    @property
    def node_bundled_abs_dir(self) -> Path:
        if (self.noraops_node_dir or "").strip():
            return Path(self.noraops_node_dir).resolve()
        ver = (self.noraops_node_version or "22.12.0").strip()
        server_root = Path(__file__).resolve().parents[2]
        return (server_root / "data" / "tools" / "node" / ver).resolve()

    @property
    def auth_mode_normalized(self) -> str:
        raw = (self.noraops_auth_mode or "open").strip().lower()
        if raw in ("windows", "windows_trust", "winauth", "iis"):
            return "windows_trust"
        if raw in ("email_otp", "otp"):
            return "email_otp"
        if raw in ("email_token", "email_access", "access_token", "token"):
            return "email_token"
        if raw == "email":
            return "email_token"
        return "open"

    @property
    def is_windows_trust_auth(self) -> bool:
        return self.auth_mode_normalized == "windows_trust"

    @property
    def is_email_otp_auth(self) -> bool:
        return self.auth_mode_normalized == "email_otp"

    @property
    def is_email_token_auth(self) -> bool:
        return self.auth_mode_normalized == "email_token"

    @property
    def allowed_email_domains(self) -> list[str]:
        raw = (self.noraops_allowed_email_domains or "").strip()
        if not raw:
            return []
        return [d.strip().lower().lstrip("@") for d in raw.split(",") if d.strip()]

    @property
    def docs_abs_dir(self) -> Path:
        if (self.noraops_docs_dir or "").strip():
            return Path(self.noraops_docs_dir).resolve()
        # nora-backend/app/core/config.py → NoraOps リポジトリルート
        return (Path(__file__).resolve().parents[3] / "NoraOps").resolve()

    @property
    def help_manifest_path(self) -> Path:
        return (Path(__file__).resolve().parents[2] / "docs" / "help" / "manifest.json").resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
