"""Test harness. Integration tests run against a REAL PostgreSQL (AGENTS.md section 7).

Set TEST_DATABASE_ADMIN_URL to a superuser connection on a throwaway server, for example
postgresql+psycopg://postgres@127.0.0.1:54329/postgres. A missing variable FAILS the run
(a silent skip would look like a pass). Tokens are signed by a locally generated ES256 key whose
JWKS is fed to the same verification code path as production (SECURITY.md section 2).
"""

import os
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import jwt
import pytest
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.core.security import JwksKeyStore, TokenVerifier
from app.main import create_app

BACKEND = Path(__file__).resolve().parent.parent
ISSUER = "https://test.example/auth/v1"
AUDIENCE = "authenticated"
KID = "test-key-1"


def _admin_url() -> str:
    url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if not url:
        pytest.fail("TEST_DATABASE_ADMIN_URL is not set; integration tests need a real PostgreSQL", pytrace=False)
    return url


def _url_for(admin_url: str, user: str, password: str | None, database: str) -> str:
    return make_url(admin_url).set(username=user, password=password, database=database).render_as_string(False)


@pytest.fixture(scope="session")
def db_name() -> str:
    return f"mf_test_{os.getpid()}"


@pytest.fixture(scope="session")
def admin_url() -> str:
    return _admin_url()


def build_database(admin_url: str, name: str) -> None:
    server = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    server.dispose()
    db_admin = create_engine(_url_for(admin_url, make_url(admin_url).username or "postgres", None, name))
    with db_admin.begin() as conn:
        # Supabase provides these API roles; creating them locally makes the no-access checks meaningful.
        conn.execute(
            text(
                "DO $$ BEGIN "
                "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; "
                "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN "
                "CREATE ROLE authenticated NOLOGIN; END IF; END $$"
            )
        )
        raw = conn.connection.driver_connection
        with raw.cursor() as cur:
            cur.execute((BACKEND / "scripts" / "bootstrap_roles.sql").read_text())
            cur.execute("ALTER ROLE mf_app PASSWORD 'test-only-app'")
            cur.execute("ALTER ROLE mf_migrator PASSWORD 'test-only-migrator'")
    db_admin.dispose()
    os.environ["MIGRATION_DATABASE_URL"] = _url_for(admin_url, "mf_migrator", "test-only-migrator", name)
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session")
def database(admin_url: str, db_name: str) -> Iterator[str]:
    build_database(admin_url, db_name)
    yield db_name
    server = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)'))
    server.dispose()


@pytest.fixture(scope="session")
def superuser_engine(admin_url: str, database: str) -> Iterator[Engine]:
    """Bypasses RLS. Used ONLY to seed rows and to inspect state, never by the API under test."""
    engine = create_engine(_url_for(admin_url, make_url(admin_url).username or "postgres", None, database))
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def app_engine(admin_url: str, database: str) -> Iterator[Engine]:
    engine = create_engine(
        _url_for(admin_url, "mf_app", "test-only-app", database),
        pool_size=5,
        max_overflow=5,
        connect_args={"prepare_threshold": None},
    )
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def migrator_engine(admin_url: str, database: str) -> Iterator[Engine]:
    engine = create_engine(_url_for(admin_url, "mf_migrator", "test-only-migrator", database))
    yield engine
    engine.dispose()


# ---------------------------------------------------------------- tokens
class Keys:
    def __init__(self) -> None:
        self.private = ec.generate_private_key(ec.SECP256R1())
        jwk = ECAlgorithm(ECAlgorithm.SHA256).to_jwk(self.private.public_key(), as_dict=True)
        jwk.update({"kid": KID, "use": "sig", "alg": "ES256"})
        self.jwks = {"keys": [jwk]}

    def token(self, sub: str | uuid.UUID, *, kid: str = KID, alg: str = "ES256", key=None, **claims) -> str:
        now = int(time.time())
        payload = {
            "sub": str(sub),
            "aud": AUDIENCE,
            "iss": ISSUER,
            "role": "authenticated",
            "iat": now,
            "exp": now + 3600,
            **claims,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        return jwt.encode(payload, key or self.private, algorithm=alg, headers={"kid": kid})


@pytest.fixture(scope="session")
def keys() -> Keys:
    return Keys()


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(
        environment="ci",
        database_url="postgresql+psycopg://mf_app:unused@localhost/unused",
        supabase_jwks_url="http://unused.invalid/jwks",
        supabase_jwt_issuer=ISSUER,
        supabase_jwt_audience=AUDIENCE,
        cors_allowed_origins="http://localhost:5173",
        log_level="INFO",
    )


@pytest.fixture(scope="session")
def client(settings: Settings, app_engine: Engine, keys: Keys) -> Iterator[TestClient]:
    verifier = TokenVerifier(JwksKeyStore(lambda: keys.jwks), issuer=ISSUER, audience=AUDIENCE)
    app = create_app(settings, engine=app_engine, verifier=verifier)
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# ---------------------------------------------------------------- helpers
class User:
    def __init__(self, keys: Keys) -> None:
        self.id = uuid.uuid4()
        self._keys = keys

    def headers(self, business_id: str | uuid.UUID | None = None) -> dict[str, str]:
        h = {"Authorization": f"Bearer {self._keys.token(self.id)}"}
        if business_id is not None:
            h["X-Business-Id"] = str(business_id)
        return h


@pytest.fixture
def new_user(keys: Keys):
    return lambda: User(keys)


@pytest.fixture
def make_business(client: TestClient):
    """Creates a business through the real API, so the user really is its owner."""

    def make(user: User, name: str = "Sample Traders") -> str:
        r = client.post("/api/v1/businesses", json={"name": name}, headers=user.headers())
        assert r.status_code == 201, r.text
        return r.json()["id"]

    return make


@pytest.fixture
def add_member(superuser_engine: Engine):
    """Adds a staff or admin membership by direct SQL, as the pilot procedure does (DECISIONS D-3)."""

    def add(business_id: str, user: User, role: str, status: str = "active") -> None:
        with superuser_engine.begin() as conn:
            conn.execute(
                text("INSERT INTO mf.memberships (business_id, user_id, role, status) VALUES (:b, :u, :r, :s)"),
                {"b": business_id, "u": user.id, "r": role, "s": status},
            )

    return add


@pytest.fixture
def tenant(new_user, make_business):
    """A fresh user who owns a fresh business."""
    user = new_user()
    return user, make_business(user)
