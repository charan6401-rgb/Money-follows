import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator, model_validator

Language = Literal["en", "te"]
_PHONE_CHARS = re.compile(r"[\s\-().]")
_MOBILE = re.compile(r"^[6-9][0-9]{9}$")


def normalize_phone(value: str) -> str:
    """Return +91XXXXXXXXXX or raise ValueError (API.md 4.1; the database CHECK requires [6-9] first)."""
    digits = _PHONE_CHARS.sub("", value)
    digits = digits[1:] if digits.startswith("+") else digits
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not _MOBILE.fullmatch(digits):
        raise ValueError("invalid phone")
    return f"+91{digits}"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Notes = Annotated[str, StringConstraints(max_length=1000)]


class CustomerCreate(StrictModel):
    name: Name
    phone: str | None = None
    notes: Notes | None = None
    preferred_language: Language = "en"

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        return None if value is None else normalize_phone(value)


class CustomerUpdate(StrictModel):
    name: Name | None = None
    phone: str | None = None
    notes: Notes | None = None
    preferred_language: Language | None = None
    is_active: bool | None = None

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        return None if value is None else normalize_phone(value)

    @model_validator(mode="after")
    def _check(self) -> "CustomerUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        for required in ("name", "preferred_language", "is_active"):
            if required in self.model_fields_set and getattr(self, required) is None:
                raise ValueError(f"{required} cannot be null")
        return self
