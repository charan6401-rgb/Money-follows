import re
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StrictBool, StrictStr, StringConstraints, field_validator, model_validator

from app.core.dates import today_ist
from app.core.money import rupees_to_paise

Method = Literal["cash", "upi", "bank_transfer", "cheque", "other"]
_NO_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PaymentCreate(StrictModel):
    amount: StrictStr
    paid_on: date
    method: Method
    reference: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] | None = None
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)] | None = None
    allow_duplicate: StrictBool = False

    @field_validator("amount")
    @classmethod
    def _amount(cls, value: str) -> str:
        rupees_to_paise(value)  # ValueError -> 422 invalid_amount
        return value

    @field_validator("reference", "note")
    @classmethod
    def _text(cls, value: str | None) -> str | None:
        if value is not None and _NO_CONTROL.search(value):
            raise ValueError("control characters")
        return value

    @model_validator(mode="after")
    def _date(self) -> "PaymentCreate":
        if self.paid_on > today_ist():
            raise ValueError("paid_on in the future")
        return self

    @property
    def amount_paise(self) -> int:
        return rupees_to_paise(self.amount)


class ReverseBody(StrictModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]
