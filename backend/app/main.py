"""FastAPI entrypoint for willynojopranoto.com and hosted games."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.avalon import api as avalon_api
from app.psych import api as psych_api
from app.shared.cookies import ensure_client_cookies
from app.spiritboard import api as spiritboard_api, hunt_api
from app.wavelength import api as wavelength_api

logging.basicConfig(level=os.environ.get("SB_LOG_LEVEL", "INFO"))

_default_static = Path(__file__).resolve().parents[2] / "frontend" / "dist"
STATIC_DIR = Path(os.environ.get("SB_STATIC_DIR", str(_default_static)))

CSP = (
    "default-src 'self'; script-src 'self'; "
    "style-src 'self' https://fonts.googleapis.com; "
    "img-src 'self' data:; "
    "font-src 'self' https://fonts.gstatic.com; "
    "connect-src 'self'; "
    "media-src 'self'; object-src 'none'; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(hunt_api.router)
app.include_router(spiritboard_api.router)
app.include_router(psych_api.router)
app.include_router(avalon_api.router)
app.include_router(wavelength_api.router)


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


@app.get("/api/session")
async def session(request: Request) -> JSONResponse:
    """Makes sure this browser has its device + CSRF cookies (the dev server path)."""
    response = JSONResponse({"ok": True})
    ensure_client_cookies(request, response)
    return response


# ---- Static frontend (production) -------------------------------------------

_index = STATIC_DIR / "index.html"


@app.api_route("/", methods=["GET", "HEAD"])
@app.api_route("/spiritboard", methods=["GET", "HEAD"])
@app.api_route("/spiritboard/play", methods=["GET", "HEAD"])
@app.api_route("/spiritboard/relics", methods=["GET", "HEAD"])
@app.api_route("/spiritboard/admin", methods=["GET", "HEAD"])
@app.api_route("/spiritboard/admin/print", methods=["GET", "HEAD"])
@app.api_route("/spiritboard/claim/{token}", methods=["GET", "HEAD"])
@app.api_route("/psychological", methods=["GET", "HEAD"])
@app.api_route("/psychological/play", methods=["GET", "HEAD"])
@app.api_route("/avalon", methods=["GET", "HEAD"])
@app.api_route("/avalon/play", methods=["GET", "HEAD"])
@app.api_route("/wavelength", methods=["GET", "HEAD"])
@app.api_route("/wavelength/play", methods=["GET", "HEAD"])
async def spa_routes(request: Request) -> Response:
    if _index.is_file():
        response: Response = FileResponse(_index, headers={"Cache-Control": "no-store"})
    else:
        response = HTMLResponse("<!doctype html><div id='root'></div>", headers={"Cache-Control": "no-store"})
    ensure_client_cookies(request, response)
    return response


if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
