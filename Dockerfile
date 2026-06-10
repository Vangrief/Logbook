FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATABASE_PATH=/data/flightarchive.db

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code.
COPY app ./app

# Cache-bust the service worker with the current git commit hash, so every
# `docker compose up --build` automatically invalidates the old PWA cache.
# Requires the .git directory to be present in the build context.
COPY .git ./.git
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "dev") \
    && sed -i "s/CACHE_VERSION_PLACEHOLDER/$GIT_HASH/" app/static/sw.js \
    && echo "Service worker cache version: logbook-$GIT_HASH" \
    && apt-get purge -y --auto-remove git \
    && rm -rf ./.git /var/lib/apt/lists/*

# Persistent data volume (SQLite database).
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 7323

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:7323/api/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7323"]
