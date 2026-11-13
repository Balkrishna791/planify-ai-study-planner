# Build the React app once, then serve it from the same secure Flask origin as
# the API. This avoids a second public port and CORS/proxy mistakes in production.
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
# The lockfile contains an optional peer used only by a nested styling tool.
# npm 10 otherwise rejects the clean install, even though the application does
# not need that peer at runtime. Keep the lockfile deterministic while using
# npm's documented compatibility mode for optional peers.
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /app/frontend/build /app/frontend/build

# Cloud platforms supply PORT. The fallback makes a local container usable too.
EXPOSE 5000
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-5000} --workers 1 --timeout 90 app:app"]
