from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.db.models import Base

_engine = None
_session_factory = None


def resolve_database_url(settings: Settings) -> str:
    if settings.db_url.strip():
        return settings.db_url.strip()
    if settings.db_backend.lower() == "postgres":
        return "postgresql+psycopg://gitea:gitea@127.0.0.1:5432/gitea"
    sqlite_path = settings.sqlite_abs_path
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{sqlite_path.as_posix()}"


def init_engine() -> None:
    global _engine, _session_factory
    if _engine is not None and _session_factory is not None:
        return
    settings = get_settings()
    db_url = resolve_database_url(settings)
    connect_args = {"check_same_thread": False} if db_url.startswith("sqlite:///") else {}
    _engine = create_engine(db_url, connect_args=connect_args, pool_pre_ping=True)
    _session_factory = sessionmaker(bind=_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=_engine)
    from app.db.migrate_identity import migrate_identity_schema
    from app.db.migrate_registry import migrate_registry_schema

    migrate_identity_schema(_engine)
    migrate_registry_schema(_engine)
    Base.metadata.create_all(bind=_engine)


def get_session() -> Generator[Session, None, None]:
    if _session_factory is None:
        init_engine()
    session = _session_factory()
    try:
        yield session
    finally:
        session.close()
