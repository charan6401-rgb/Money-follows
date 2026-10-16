"""Opaque keyset cursors (API.md section 1). The cursor only carries sort keys; every query still
filters by the verified tenant, so a forged cursor can never reach another tenant's rows."""

import base64
import json
from typing import Any

from app.core.exceptions import ApiError

DEFAULT_LIMIT = 25
MAX_LIMIT = 100


def encode_cursor(values: list[Any]) -> str:
    raw = json.dumps(values, separators=(",", ":"), default=str).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str | None, expected_length: int) -> list[Any] | None:
    if cursor is None:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        values = json.loads(base64.urlsafe_b64decode(padded.encode()))
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", [{"field": "cursor", "code": "invalid"}]) from None
    if not isinstance(values, list) or len(values) != expected_length:
        raise ApiError(422, "validation_error", [{"field": "cursor", "code": "invalid"}])
    return values
