"""IST business dates. India has no daylight saving time, so a fixed UTC+05:30 offset is exact."""

from datetime import UTC, date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), name="IST")
MIN_INVOICE_DATE = date(2000, 1, 1)


def today_ist(now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(IST).date()


def fy_start_year(d: date) -> int:
    """Indian financial year start: 2026-03-31 -> 2025, 2026-04-01 -> 2026 (DECISIONS D-1)."""
    return d.year - 1 if d.month < 4 else d.year


def fy_label(start_year: int) -> str:
    return f"{start_year}-{(start_year + 1) % 100:02d}"
