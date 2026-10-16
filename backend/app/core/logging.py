"""Structured logging with redaction (SECURITY.md section 15).

Allowed in log lines: request id, user id, business id, route template, method, status,
duration, error code. Tokens, bodies, names, phones, notes, CSV rows and DB URLs are never logged.
"""

import logging
import re
import sys

_REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer [redacted]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*"), "[jwt]"),
    (re.compile(r"postgres(?:ql)?(?:\+\w+)?://\S+", re.I), "[db-url]"),
    (re.compile(r"\+?91[\s-]?[6-9][0-9]{4}[\s-]?[0-9]{5}"), "[phone]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
]

_FORBIDDEN_EXTRA = {"authorization", "cookie", "body", "token", "phone", "name", "notes", "query"}
_ALLOWED_EXTRA = (
    "request_id",
    "user_id",
    "business_id",
    "route",
    "method",
    "status",
    "duration_ms",
    "error_code",
)


def redact(text: str) -> str:
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


class RedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.getMessage())
        record.args = None
        for key in list(record.__dict__):
            if key.lower() in _FORBIDDEN_EXTRA:
                del record.__dict__[key]
        if record.exc_info:
            # Keep the exception type only; messages can carry SQL parameters or PII.
            exc_type = record.exc_info[0]
            record.msg = f"{record.msg} [{exc_type.__name__ if exc_type else 'error'}]"
            record.exc_info = None
            record.exc_text = None
        return True


class KeyValueFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        parts = [f"level={record.levelname}", f"logger={record.name}", f"msg={record.getMessage()!r}"]
        for key in _ALLOWED_EXTRA:
            if hasattr(record, key):
                parts.append(f"{key}={getattr(record, key)}")
        return " ".join(parts)


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(KeyValueFormatter())
    handler.addFilter(RedactionFilter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Parameter logging stays off: these loggers would print bound values (names, phones, amounts).
    for noisy in ("sqlalchemy.engine", "sqlalchemy.pool", "psycopg"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
