from collections.abc import Callable
from typing import Annotated

from fastapi import Depends

from app.core.exceptions import ApiError
from app.dependencies.business import Tenant, get_tenant

# DECISIONS D-4: owner and admin share every privilege; staff is the lowest role.
_RANK = {"staff": 1, "admin": 2, "owner": 3}


def require_role(minimum: str) -> Callable[..., Tenant]:
    """Dependency factory. The role is read from the database, never from the client."""

    def dependency(tenant: Annotated[Tenant, Depends(get_tenant, scope="function")]) -> Tenant:
        if _RANK.get(tenant.role, 0) < _RANK[minimum]:
            raise ApiError(403, "forbidden_role")
        return tenant

    return dependency


require_staff = require_role("staff")
require_admin = require_role("admin")
