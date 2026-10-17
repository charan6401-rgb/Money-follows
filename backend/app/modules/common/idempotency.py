"""Idempotency keys for money-moving POSTs (API.md section 1, DATABASE.md sections 4.12 and 6).

The key claim and the business write commit together. A crash or any error rolls both back, so
a retry starts clean. A concurrent request with the same key waits on the unique index, then sees
the committed row and replays the stored response.
"""

import hashlib
import json
import re
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text

from app.core.exceptions import ApiError
from app.dependencies.business import Tenant

_KEY = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


@dataclass
class Claim:
    """Either a fresh claim to complete, or a stored response to replay."""

    key_id: uuid.UUID | None = None
    replay_status: int | None = None
    replay_body: dict[str, Any] | None = None

    @property
    def is_replay(self) -> bool:
        return self.replay_status is not None


def require_key(value: str | None) -> str:
    if not value:
        raise ApiError(400, "idempotency_key_required")
    if not _KEY.match(value):
        raise ApiError(422, "validation_error", [{"field": "Idempotency-Key", "code": "invalid"}])
    return value


def request_hash(route: str, path_params: dict[str, str], body: dict[str, Any]) -> bytes:
    canonical = json.dumps(
        {"route": route, "path": path_params, "body": body}, sort_keys=True, separators=(",", ":"), default=str
    )
    return hashlib.sha256(canonical.encode()).digest()


def claim(tenant: Tenant, key: str, route: str, digest: bytes) -> Claim:
    # Opportunistic cleanup, at most 50 expired rows (the DELETE policy allows only expired rows).
    tenant.conn.execute(
        text(
            "DELETE FROM mf.idempotency_keys WHERE id IN ("
            "SELECT id FROM mf.idempotency_keys WHERE business_id = :b AND expires_at < now() LIMIT 50)"
        ),
        {"b": tenant.business_id},
    )
    inserted = tenant.conn.execute(
        text(
            "INSERT INTO mf.idempotency_keys (business_id, user_id, key, method, route, request_hash) "
            "VALUES (:b, :u, :k, 'POST', :r, :h) ON CONFLICT (business_id, key) DO NOTHING RETURNING id"
        ),
        {"b": tenant.business_id, "u": tenant.user_id, "k": key, "r": route, "h": digest},
    ).scalar_one_or_none()
    if inserted is not None:
        return Claim(key_id=inserted)
    existing = (
        tenant.conn.execute(
            text(
                "SELECT request_hash, response_status, response_body FROM mf.idempotency_keys "
                "WHERE business_id = :b AND key = :k"
            ),
            {"b": tenant.business_id, "k": key},
        )
        .mappings()
        .first()
    )
    if existing is None or bytes(existing["request_hash"]) != digest or existing["response_status"] is None:
        raise ApiError(422, "idempotency_key_reuse")
    return Claim(replay_status=existing["response_status"], replay_body=existing["response_body"])


def complete(tenant: Tenant, key_id: uuid.UUID, status: int, body: dict[str, Any]) -> None:
    tenant.conn.execute(
        text(
            "UPDATE mf.idempotency_keys SET response_status = :s, response_body = CAST(:b AS jsonb) "
            "WHERE business_id = :biz AND id = :id"
        ),
        {"s": status, "b": json.dumps(body), "biz": tenant.business_id, "id": key_id},
    )
