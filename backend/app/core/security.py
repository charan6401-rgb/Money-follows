"""Supabase access-token verification through the JWKS (SECURITY.md sections 2 and 3, DECISIONS D-6).

- Only ES256 and RS256. `none`, HS* and anything else is rejected before any key lookup.
- Required claims: exp, sub, aud, iss. Anonymous tokens and role != authenticated are rejected.
- No shared secret exists anywhere in this code.
- Unknown `kid` values trigger at most one refresh per cooldown, capped per hour, and are
  negatively cached, so an attacker cannot make the API fetch the JWKS on every request.
- If the JWKS endpoint is unreachable, keys already cached keep working. With no usable key the
  caller gets 503, never an accepted token.
Token content is never logged; the caller only sees the verified subject.
"""

import threading
import time
import uuid
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWK, PyJWKClient, PyJWKSet
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError

from app.core.exceptions import ApiError

ALLOWED_ALGORITHMS = ("ES256", "RS256")
LEEWAY_SECONDS = 30  # proposed default, not yet validated against real Supabase clock skew


class JwksUnavailable(Exception):
    """No usable signing key and the JWKS endpoint could not be reached."""


class UnknownKey(Exception):
    """The token's kid is not in the JWKS."""


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: uuid.UUID


def http_jwks_fetcher(url: str, timeout_s: int = 5) -> Callable[[], dict[str, Any]]:
    client = PyJWKClient(url, timeout=timeout_s, cache_jwk_set=False, cache_keys=False)

    def fetch() -> dict[str, Any]:
        return client.fetch_data()

    return fetch


class JwksKeyStore:
    """Caches signing keys with a refresh policy that cannot be driven by attacker input."""

    def __init__(
        self,
        fetch: Callable[[], dict[str, Any]],
        *,
        clock: Callable[[], float] = time.monotonic,
        ttl_s: float = 600,
        refresh_cooldown_s: float = 60,
        max_forced_refreshes_per_hour: int = 5,
        negative_ttl_s: float = 60,
        failure_backoff_s: float = 10,
    ) -> None:
        self._fetch = fetch
        self._clock = clock
        self._ttl = ttl_s
        self._cooldown = refresh_cooldown_s
        self._max_forced = max_forced_refreshes_per_hour
        self._neg_ttl = negative_ttl_s
        self._failure_backoff = failure_backoff_s
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._last_forced: float | None = None
        self._forced_times: deque[float] = deque()
        self._negative: dict[str, float] = {}
        self._failed_at: float | None = None
        self._lock = threading.Lock()

    def _refresh(self) -> bool:
        try:
            jwk_set = PyJWKSet.from_dict(self._fetch())
        except Exception:
            self._failed_at = self._clock()
            return False
        self._keys = {k.key_id: k for k in jwk_set.keys if k.key_id}
        self._fetched_at = self._clock()
        self._failed_at = None
        return True

    def get(self, kid: str) -> PyJWK:
        with self._lock:
            now = self._clock()
            fresh = self._fetched_at is not None and now - self._fetched_at < self._ttl

            if self._negative.get(kid, 0) > now:
                raise UnknownKey

            if kid in self._keys and fresh:
                return self._keys[kid]

            in_backoff = self._failed_at is not None and now - self._failed_at < self._failure_backoff

            if not fresh and not in_backoff:
                # Scheduled refresh: the cache is empty or past its lifetime.
                self._refresh()
                now = self._clock()
            elif fresh and kid not in self._keys:
                # Forced refresh because of an unknown kid, subject to cooldown and an hourly cap.
                while self._forced_times and now - self._forced_times[0] > 3600:
                    self._forced_times.popleft()
                cooled = self._last_forced is None or now - self._last_forced >= self._cooldown
                if cooled and len(self._forced_times) < self._max_forced:
                    self._last_forced = now
                    self._forced_times.append(now)
                    self._refresh()
                    now = self._clock()

            if kid in self._keys:
                return self._keys[kid]
            if not self._keys:
                raise JwksUnavailable
            if self._failed_at is None:
                # Only remember "unknown" when the JWKS answered; an outage must not poison it.
                self._negative[kid] = now + self._neg_ttl
            raise UnknownKey


class TokenVerifier:
    def __init__(self, store: JwksKeyStore, *, issuer: str, audience: str) -> None:
        self._store = store
        self._issuer = issuer
        self._audience = audience

    def verify(self, token: str) -> AuthenticatedUser:
        unauthenticated = ApiError(401, "unauthenticated")
        try:
            header = jwt.get_unverified_header(token)
        except InvalidTokenError:
            raise unauthenticated from None

        alg = header.get("alg")
        kid = header.get("kid")
        if alg not in ALLOWED_ALGORITHMS or not isinstance(kid, str) or not kid:
            raise unauthenticated

        try:
            signing_key = self._store.get(kid)
        except UnknownKey:
            raise unauthenticated from None
        except JwksUnavailable:
            raise ApiError(503, "service_unavailable") from None

        try:
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=list(ALLOWED_ALGORITHMS),
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
                leeway=LEEWAY_SECONDS,
            )
        except ExpiredSignatureError:
            raise ApiError(401, "token_expired") from None
        except InvalidTokenError:
            raise unauthenticated from None

        try:
            user_id = uuid.UUID(str(claims["sub"]))
        except (ValueError, KeyError):
            raise unauthenticated from None
        if claims.get("role") != "authenticated" or claims.get("is_anonymous") is True:
            raise unauthenticated
        return AuthenticatedUser(user_id=user_id)
