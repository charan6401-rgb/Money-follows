"""Strict rupee string -> integer paise at the API boundary (DECISIONS D-10, SECURITY.md section 10).

Money is never a float. A rupee amount arrives as a JSON string matching
^[0-9]{1,12}(\\.[0-9]{1,2})?$ and is converted with Decimal only here.
"""

import re
from decimal import Decimal

MAX_PAISE = 99_999_999_999_999
_RUPEES = re.compile(r"^[0-9]{1,12}(\.[0-9]{1,2})?$")


def rupees_to_paise(text: str) -> int:
    """Return paise for a valid positive rupee string, or raise ValueError."""
    if not _RUPEES.fullmatch(text):
        raise ValueError("invalid rupee amount")
    paise = int((Decimal(text) * 100).to_integral_exact())
    if paise <= 0 or paise > MAX_PAISE:
        raise ValueError("amount out of range")
    return paise
