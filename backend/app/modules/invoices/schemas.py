import re
import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StrictStr, StringConstraints, field_validator, model_validator

from app.core.dates import MIN_INVOICE_DATE, today_ist
from app.core.money import rupees_to_paise

Notes = Annotated[str, StringConstraints(max_length=1000)]
_WS = re.compile(r"\s+")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InvoiceCreate(StrictModel):
    customer_id: uuid.UUID
    invoice_number: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    invoice_date: date
    due_date: date
    # A JSON string only; numbers, exponents, negatives and >2 decimals are rejected as invalid_amount.
    amount: StrictStr
    notes: Notes | None = None

    @field_validator("amount")
    @classmethod
    def _amount(cls, value: str) -> str:
        rupees_to_paise(value)  # raises ValueError -> 422 invalid_amount
        return value

    @field_validator("invoice_number")
    @classmethod
    def _number_has_content(cls, value: str) -> str:
        if not _WS.sub("", value):
            raise ValueError("empty")
        return value

    @model_validator(mode="after")
    def _dates(self) -> "InvoiceCreate":
        if self.invoice_date < MIN_INVOICE_DATE:
            raise ValueError("invoice_date too old")
        if self.invoice_date > today_ist():
            raise ValueError("invoice_date in the future")
        if self.due_date < self.invoice_date:
            raise ValueError("due_date before invoice_date")
        return self

    @property
    def total_paise(self) -> int:
        return rupees_to_paise(self.amount)


class InvoiceUpdate(StrictModel):
    due_date: date | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "InvoiceUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class ReasonBody(StrictModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]


PaymentStateFilter = Literal["unpaid", "partial", "settled"]
StatusFilter = Literal["open", "cancelled"]
