"""Shared device/CSRF cookies and in-memory HTTP rate limiters."""

from __future__ import annotations

import hmac
import re
import secrets
import time

from fastapi import HTTPException, Request, Response

from app.shared.origins import origin_ok

COOKIE_DEVICE = "__Host-sb_device"
COOKIE_CSRF = "__Host-sb_csrf"
DEVICE_MAX_AGE = 30 * 24 * 3600
DEVICE_RE = re.compile(r"[A-Za-z0-9_-]{43}")


def new_device_id() -> str:
    """256-bit random id stored in an HttpOnly cookie."""
    return secrets.token_urlsafe(32)


def valid_device(raw: object) -> bool:
    return isinstance(raw, str) and bool(DEVICE_RE.fullmatch(raw))


def set_cookie(
    response: Response,
    name: str,
    value: str,
    max_age: int,
    *,
    http_only: bool,
    same_site: str,
) -> None:
    # __Host- prefix: Secure, Path=/, and no Domain, so it can't leak to subdomains.
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path="/",
        secure=True,
        httponly=http_only,
        samesite=same_site,
    )


def ensure_client_cookies(request: Request, response: Response) -> None:
    """Gives this browser a device id and a CSRF token if it doesn't have valid ones."""
    if not valid_device(request.cookies.get(COOKIE_DEVICE)):
        set_cookie(
            response,
            COOKIE_DEVICE,
            new_device_id(),
            DEVICE_MAX_AGE,
            http_only=True,
            same_site="lax",
        )
    csrf = request.cookies.get(COOKIE_CSRF, "")
    if not (isinstance(csrf, str) and len(csrf) == 43):
        # Readable by our JS (that's the point of double-submit); not a credential by itself.
        set_cookie(
            response,
            COOKIE_CSRF,
            secrets.token_urlsafe(32),
            DEVICE_MAX_AGE,
            http_only=False,
            same_site="lax",
        )


def device_of(cookies: dict[str, str]) -> str | None:
    dev = cookies.get(COOKIE_DEVICE)
    return dev if valid_device(dev) else None


def check_csrf(request: Request) -> None:
    if not origin_ok(request.headers.get("origin"), request.headers.get("host")):
        raise HTTPException(403, "Bad origin.")
    cookie = request.cookies.get(COOKIE_CSRF, "")
    header = request.headers.get("x-csrf-token", "")
    if not cookie or not hmac.compare_digest(cookie.encode(), header.encode()):
        raise HTTPException(403, "Refresh the page and try again.")


class Limiter:
    """Token buckets per key, in memory (the service runs as a single instance)."""

    def __init__(self, per_minute: float, burst: float) -> None:
        self.rate = per_minute / 60.0
        self.burst = burst
        self.buckets: dict[str, tuple[float, float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        if len(self.buckets) > 5000:  # crude cap so the dict can't grow without bound
            self.buckets = {k: v for k, v in self.buckets.items() if now - v[1] < 600}
        tokens, last = self.buckets.get(key, (self.burst, now))
        tokens = min(self.burst, tokens + (now - last) * self.rate)
        if tokens < 1:
            self.buckets[key] = (tokens, now)
            return False
        self.buckets[key] = (tokens - 1, now)
        return True


def client_ip(request: Request) -> str:
    # Cloud Run appends the real client address to X-Forwarded-For. Callers can
    # spoof earlier entries, so per-IP limits are paired with global ones.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "?"
