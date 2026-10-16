from fastapi import Header, Request

from app.core.exceptions import ApiError
from app.core.security import AuthenticatedUser, TokenVerifier


def get_current_user(request: Request, authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    """Verify the Supabase access token. Identity comes only from verified claims."""
    if not authorization:
        raise ApiError(401, "unauthenticated")
    scheme, _, token = authorization.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "unauthenticated")
    verifier: TokenVerifier = request.app.state.verifier
    user = verifier.verify(token)
    request.state.user_id = str(user.user_id)
    return user
