from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

Language = Literal["en", "te"]
Name2to120 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MeUpdate(StrictModel):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)] | None = None
    preferred_language: Language | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "MeUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class BusinessCreate(StrictModel):
    name: Name2to120
    default_language: Language = "en"


class MeOut(BaseModel):
    user_id: str
    display_name: str | None
    preferred_language: Language
    profile_exists: bool


class WorkspaceOut(BaseModel):
    id: str
    name: str
    role: str
    default_language: Language


class WorkspaceList(BaseModel):
    items: list[WorkspaceOut]
