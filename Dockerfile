# syntax=docker/dockerfile:1
# Single Cloud Run service: FastAPI serves the API, WebSockets, and the built
# React frontend from the same origin.
# TODO(security): pin base images by digest once the stack settles.

# ---- Build the frontend ------------------------------------------------------
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# ---- Runtime ------------------------------------------------------------------
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SB_STATIC_DIR=/app/static
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./static

RUN useradd --system --uid 10001 app && chown -R app /app
USER app

# Cloud Run injects $PORT. Binding 0.0.0.0 is required inside the container;
# local dev still binds 127.0.0.1 (see README).
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'
