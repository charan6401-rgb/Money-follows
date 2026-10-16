"""Identity and workspaces (API.md section 3). None of these needs X-Business-Id except /members."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.exceptions import ApiError
from app.db.session import Tx
from app.dependencies.business import Tenant
from app.dependencies.db import get_tx
from app.dependencies.roles import require_staff
from app.modules.common.db_errors import map_db_error
from app.modules.common.pagination import DEFAULT_LIMIT, MAX_LIMIT, decode_cursor, encode_cursor
from app.modules.identity.schemas import BusinessCreate, MeOut, MeUpdate, WorkspaceList, WorkspaceOut

router = APIRouter(tags=["identity"])

_PROFILE_SQL = "SELECT display_name, preferred_language FROM mf.user_profiles WHERE user_id = :u"


def _me(tx: Tx) -> MeOut:
    row = tx.conn.execute(text(_PROFILE_SQL), {"u": tx.user_id}).mappings().first()
    return MeOut(
        user_id=str(tx.user_id),
        display_name=row["display_name"] if row else None,
        preferred_language=row["preferred_language"] if row else "en",
        profile_exists=row is not None,
    )


@router.get("/me", response_model=MeOut)
def get_me(tx: Annotated[Tx, Depends(get_tx, scope="function")]) -> MeOut:
    return _me(tx)


@router.patch("/me", response_model=MeOut)
def patch_me(body: MeUpdate, tx: Annotated[Tx, Depends(get_tx, scope="function")]) -> MeOut:
    # Upsert of the caller's own row only; user_id comes from the verified token.
    fields = body.model_fields_set
    tx.conn.execute(
        text(
            "INSERT INTO mf.user_profiles (user_id, display_name, preferred_language) "
            "VALUES (:u, :dn, COALESCE(:pl, 'en')) "
            "ON CONFLICT (user_id) DO UPDATE SET "
            "display_name = CASE WHEN :set_dn THEN EXCLUDED.display_name ELSE mf.user_profiles.display_name END, "
            "preferred_language = CASE WHEN :set_pl THEN EXCLUDED.preferred_language "
            "ELSE mf.user_profiles.preferred_language END"
        ),
        {
            "u": tx.user_id,
            "dn": body.display_name,
            "pl": body.preferred_language,
            "set_dn": "display_name" in fields,
            "set_pl": "preferred_language" in fields,
        },
    )
    return _me(tx)


def _workspace(tx: Tx, business_id: uuid.UUID) -> WorkspaceOut:
    row = (
        tx.conn.execute(
            text(
                "SELECT b.id, b.name, m.role, b.default_language FROM mf.businesses b "
                "JOIN mf.memberships m ON m.business_id = b.id "
                "WHERE b.id = :b AND m.user_id = :u AND m.status = 'active'"
            ),
            {"b": business_id, "u": tx.user_id},
        )
        .mappings()
        .one()
    )
    return WorkspaceOut(id=str(row["id"]), name=row["name"], role=row["role"], default_language=row["default_language"])


@router.get("/businesses", response_model=WorkspaceList)
def list_businesses(tx: Annotated[Tx, Depends(get_tx, scope="function")]) -> WorkspaceList:
    rows = (
        tx.conn.execute(
            text(
                "SELECT b.id, b.name, m.role, b.default_language FROM mf.businesses b "
                "JOIN mf.memberships m ON m.business_id = b.id "
                "WHERE m.user_id = :u AND m.status = 'active' ORDER BY b.created_at, b.id LIMIT 50"
            ),
            {"u": tx.user_id},
        )
        .mappings()
        .all()
    )
    return WorkspaceList(
        items=[
            WorkspaceOut(id=str(r["id"]), name=r["name"], role=r["role"], default_language=r["default_language"])
            for r in rows
        ]
    )


@router.post("/businesses", response_model=WorkspaceOut, status_code=201)
def create_business(body: BusinessCreate, tx: Annotated[Tx, Depends(get_tx, scope="function")]) -> WorkspaceOut:
    # The id, owner and role are chosen by the database function from the verified user context.
    try:
        business_id = tx.conn.execute(
            text("SELECT mf.mf_create_business(:n, :l)"), {"n": body.name, "l": body.default_language}
        ).scalar_one()
    except DBAPIError as exc:
        raise map_db_error(exc) from None
    return _workspace(tx, business_id)


@router.get("/members")
def list_members(
    tenant: Annotated[Tenant, Depends(require_staff, scope="function")],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: str | None = None,
) -> dict:
    after = decode_cursor(cursor, 2)
    params: dict = {"b": tenant.business_id, "lim": limit + 1}
    keyset = ""
    if after:
        try:
            params["c_at"], params["c_id"] = after[0], uuid.UUID(str(after[1]))
        except ValueError:
            raise ApiError(422, "validation_error", [{"field": "cursor", "code": "invalid"}]) from None
        keyset = "AND (m.created_at, m.id) > (CAST(:c_at AS timestamptz), :c_id)"
    rows = (
        tenant.conn.execute(
            text(
                "SELECT m.id, m.user_id, m.role, m.status, m.created_at, p.display_name "
                "FROM mf.memberships m LEFT JOIN mf.user_profiles p ON p.user_id = m.user_id "
                f"WHERE m.business_id = :b {keyset} ORDER BY m.created_at, m.id LIMIT :lim"
            ),
            params,
        )
        .mappings()
        .all()
    )
    page = rows[:limit]
    next_cursor = (
        encode_cursor([page[-1]["created_at"].isoformat(), str(page[-1]["id"])]) if len(rows) > limit else None
    )
    return {
        "items": [
            {
                "membership_id": str(r["id"]),
                "user_id": str(r["user_id"]),
                # RLS lets a user read only their own profile, so other members show null for now.
                "display_name": r["display_name"],
                "role": r["role"],
                "status": r["status"],
            }
            for r in page
        ],
        "next_cursor": next_cursor,
    }
