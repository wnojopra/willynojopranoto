"""HTTP API for the scavenger hunt: claiming Relics, your collection, and the admin page.

Security model (see README "Security notes"):
- Players: an unguessable device id in an HttpOnly `__Host-` cookie, set when a
  page loads. No login; whoever holds the phone owns its Relics.
- Admin: a host passcode from Secret Manager (env SB_ADMIN_PASSCODE, no default:
  admin is disabled without it). A successful login gets a random session id in
  an HttpOnly, SameSite=Strict `__Host-` cookie that expires after 12 hours.
- CSRF: every POST needs a same-origin Origin header AND a double-submit token
  (the `__Host-sb_csrf` cookie echoed in the X-CSRF-Token header).
- Rate limits on claims and logins. All responses are no-store.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.shared.cookies import (
    COOKIE_CSRF,
    COOKIE_DEVICE,
    DEVICE_MAX_AGE,
    Limiter,
    check_csrf as _check_csrf,
    client_ip as _client_ip,
    device_of,
    ensure_client_cookies,
    set_cookie as _set_cookie,
)
from app.shared.rooms_util import JoinError, normalize_name
from app.spiritboard import hunt, questions
from app.spiritboard.rooms import RELIC_CATALOG_DICT

log = logging.getLogger("spiritboard.api")

COOKIE_ADMIN = "__Host-sb_admin"
ADMIN_TTL = 12 * 3600

store: hunt.HuntStore = hunt.make_store(
    os.environ.get("SB_FIRESTORE_DATABASE"), os.environ.get("GOOGLE_CLOUD_PROJECT")
)


def _admin_passcode() -> str | None:
    code = os.environ.get("SB_ADMIN_PASSCODE", "").strip()
    return code or None


claim_limiter = Limiter(per_minute=20, burst=10)
login_limiter = Limiter(per_minute=5, burst=5)
login_global = Limiter(per_minute=20, burst=20)
admin_limiter = Limiter(per_minute=120, burst=60)


# ---- Admin sessions ---------------------------------------------------------

_admin_sessions: dict[str, float] = {}  # session id -> expiry (monotonic)


def _is_admin(request: Request) -> bool:
    sid = request.cookies.get(COOKIE_ADMIN)
    if not sid or _admin_passcode() is None:
        return False
    exp = _admin_sessions.get(sid)
    if exp is None:
        return False
    if exp < time.monotonic():
        _admin_sessions.pop(sid, None)
        return False
    return True


def _require_admin(request: Request) -> None:
    if not _is_admin(request):
        raise HTTPException(401, "Log in first.")
    if not admin_limiter.allow(_client_ip(request)):
        raise HTTPException(429, "Slow down.")


# ---- Routes -----------------------------------------------------------------

router = APIRouter(prefix="/api")


@router.get("/catalog")
async def catalog() -> dict:
    return {"relics": RELIC_CATALOG_DICT}


@router.get("/me")
async def me(request: Request) -> dict:
    device = device_of(request.cookies)
    if device is None:
        return {"name": None, "relics": []}
    dev = await store.get_device(device)
    return {"name": dev.name, "relics": dev.relics}


@router.get("/claim/{token}")
async def peek_claim(token: str, request: Request) -> dict:
    if not hunt.valid_token(token):
        return {"status": "invalid", "relic": None}
    result = await store.peek(token, device_of(request.cookies))
    return {"status": result.status, "relic": result.relic}


class ClaimBody(BaseModel):
    name: str | None = Field(default=None, max_length=40)


@router.post("/claim/{token}")
async def claim(token: str, body: ClaimBody, request: Request) -> dict:
    _check_csrf(request)
    device = device_of(request.cookies)
    if device is None:
        raise HTTPException(400, "Open the link again (cookies are needed to keep your Relics).")
    if not claim_limiter.allow(device) or not claim_limiter.allow("ip:" + _client_ip(request)):
        raise HTTPException(429, "Slow down, ghost hunter.")
    if not hunt.valid_token(token):
        return {"status": "invalid", "relic": None}
    name = None
    if body.name is not None:
        try:
            name = normalize_name(body.name)
        except JoinError as e:
            raise HTTPException(400, str(e)) from None
    result = await store.claim(token, device, name)
    if result.status == "claimed":
        log.info("relic claimed: %s", result.relic)  # no device ids or tokens in logs
    return {"status": result.status, "relic": result.relic}


@router.get("/admin/session")
async def admin_session(request: Request) -> dict:
    return {"configured": _admin_passcode() is not None, "admin": _is_admin(request)}


class LoginBody(BaseModel):
    passcode: str = Field(max_length=200)


@router.post("/admin/login")
async def admin_login(body: LoginBody, request: Request, response: Response) -> dict:
    _check_csrf(request)
    expected = _admin_passcode()
    if expected is None:
        raise HTTPException(503, "Admin isn't set up on this server.")
    if not login_limiter.allow(_client_ip(request)) or not login_global.allow("all"):
        raise HTTPException(429, "Too many tries. Wait a minute.")
    if not hmac.compare_digest(body.passcode.strip().encode(), expected.encode()):
        log.warning("admin login failed")  # never log what was typed
        raise HTTPException(401, "Wrong passcode.")
    sid = secrets.token_urlsafe(32)
    now = time.monotonic()
    for k in [k for k, exp in _admin_sessions.items() if exp < now]:
        _admin_sessions.pop(k, None)
    _admin_sessions[sid] = now + ADMIN_TTL
    _set_cookie(response, COOKIE_ADMIN, sid, ADMIN_TTL, http_only=True, same_site="strict")
    return {"admin": True}


@router.post("/admin/logout")
async def admin_logout(request: Request, response: Response) -> dict:
    _check_csrf(request)
    sid = request.cookies.get(COOKIE_ADMIN)
    if sid:
        _admin_sessions.pop(sid, None)
    response.delete_cookie(COOKIE_ADMIN, path="/", secure=True, httponly=True, samesite="strict")
    return {"admin": False}


@router.get("/admin/codes")
async def admin_codes(request: Request) -> dict:
    _require_admin(request)
    codes = await store.list_codes()
    return {"codes": [c.to_admin_dict() for c in codes], "max": hunt.MAX_CODES}


class CreateBody(BaseModel):
    count: int = Field(ge=1, le=hunt.MAX_BATCH)
    label: str = Field(default="", max_length=200)
    relic: str | None = Field(default=None, max_length=20)
    tier: str | None = Field(default=None, max_length=20)


@router.post("/admin/codes")
async def admin_create(body: CreateBody, request: Request) -> dict:
    _check_csrf(request)
    _require_admin(request)
    try:
        relic, tier = hunt.validate_prize(body.relic, body.tier)
        made = await store.create_codes(body.count, hunt.clean_label(body.label), relic, tier)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    return {"codes": [c.to_admin_dict() for c in made]}


@router.post("/admin/codes/{token}/delete")
async def admin_delete(token: str, request: Request) -> dict:
    _check_csrf(request)
    _require_admin(request)
    if not hunt.valid_token(token) or not await store.delete_code(token):
        raise HTTPException(404, "No such code.")
    return {"ok": True}


# ---- Custom questions (design doc §5.3) ---------------------------------------


@router.get("/admin/questions")
async def admin_questions(request: Request) -> dict:
    _require_admin(request)
    qs = await store.list_questions()
    return {"questions": [q.to_dict() for q in qs], "max": questions.MAX_CUSTOM}


class QuestionBody(BaseModel):
    deck: str = Field(max_length=10)
    kind: str = Field(max_length=10)
    text: str = Field(max_length=400)
    options: list[str] = Field(default_factory=list, max_length=10)
    always: bool = False


@router.post("/admin/questions")
async def admin_add_question(body: QuestionBody, request: Request) -> dict:
    _check_csrf(request)
    _require_admin(request)
    if any(len(o) > 100 for o in body.options):
        raise HTTPException(400, "Options are too long.")
    try:
        q = hunt.new_question(body.deck, body.kind, body.text, body.options, body.always)
        await store.add_question(q)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    return {"question": q.to_dict()}


class AlwaysBody(BaseModel):
    always: bool


@router.post("/admin/questions/{qid}")
async def admin_update_question(qid: str, body: AlwaysBody, request: Request) -> dict:
    _check_csrf(request)
    _require_admin(request)
    if not hunt.valid_question_id(qid) or not await store.set_question_always(qid, body.always):
        raise HTTPException(404, "No such question.")
    return {"ok": True}


@router.post("/admin/questions/{qid}/delete")
async def admin_delete_question(qid: str, request: Request) -> dict:
    _check_csrf(request)
    _require_admin(request)
    if not hunt.valid_question_id(qid) or not await store.delete_question(qid):
        raise HTTPException(404, "No such question.")
    return {"ok": True}
