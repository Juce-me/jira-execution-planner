FROM node:20-bookworm-slim AS frontend-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/src ./frontend/src
RUN npm run build


FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PORT=5050 \
    WEB_CONCURRENCY=1 \
    GUNICORN_THREADS=8 \
    GUNICORN_TIMEOUT=120

WORKDIR /app

RUN useradd --create-home --shell /usr/sbin/nologin appuser

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY pyproject.toml README.md LICENSE ./
COPY backend ./backend
COPY planning ./planning
COPY jira_server.py jira-dashboard.html favicon.ico epm-burst.svg ./
RUN python -m pip install --no-cache-dir -e .

COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY scripts/check_startup_preflight.py scripts/docker-entrypoint.sh ./scripts/
RUN chmod +x /app/scripts/docker-entrypoint.sh && chown -R appuser:appuser /app

USER appuser

EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '5050') + '/health', timeout=3).read()"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
