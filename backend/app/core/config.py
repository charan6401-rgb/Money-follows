"""Validated runtime settings (ARCHITECTURE.md section 11).

Read from the environment only. There is deliberately no SUPABASE_JWT_SECRET and no
service-role key: tokens are verified through the JWKS (SECURITY.md section 2).
"""

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    environment: Literal["local", "ci", "production"] = "local"
    # Runtime connection as role mf_app. Never the migrator.
    database_url: SecretStr
    supabase_jwks_url: str
    supabase_jwt_issuer: str
    supabase_jwt_audience: str = "authenticated"
    cors_allowed_origins: str = ""

    # Sizing is provisional until the S0 pooler results exist.
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_timeout_s: int = 10
    db_statement_timeout_ms: int = 15_000
    db_lock_timeout_ms: int = 5_000
    log_level: str = "INFO"

    @field_validator("database_url")
    @classmethod
    def _driver(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        if not raw.startswith("postgresql+psycopg://"):
            raise ValueError("DATABASE_URL must start with postgresql+psycopg://")
        return value

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        for origin in self.cors_origins:
            parts = urlsplit(origin)
            if origin == "*" or "*" in origin or parts.scheme not in ("http", "https") or not parts.netloc:
                raise ValueError("CORS_ALLOWED_ORIGINS must be explicit http(s) origins, no wildcard")
        if self.environment == "production":
            urls = [self.supabase_jwks_url, self.supabase_jwt_issuer, *self.cors_origins]
            if any(not u.startswith("https://") for u in urls):
                raise ValueError("production requires https for JWKS, issuer and CORS origins")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
