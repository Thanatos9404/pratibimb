# Pratibimb API image. Build from the repository root:
#   docker build -f engine/Dockerfile -t pratibimb-api --build-arg PROFILE=small .
# The image generates its own (deterministic) synthetic data at build time with the chosen profile
# and serves it with `pratibimb serve` on $PORT (default 8000). Headline metrics/validation reports from
# a full run in ./reports (if present) are served by /api/metrics and /api/cohort/validation.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NUMBA_CACHE_DIR=/tmp/numba-cache \
    MPLBACKEND=Agg

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY engine/pyproject.toml engine/README.md /app/engine/
COPY engine/pratibimb /app/engine/pratibimb
RUN pip install /app/engine

ARG PROFILE=small
ENV PRATIBIMB_PROFILE=${PROFILE} \
    PRATIBIMB_DATA=/app/data \
    PRATIBIMB_METRICS_DIR=/app/reports \
    PORT=8000

COPY reports /app/reports
RUN pratibimb build --profile ${PROFILE} --workers 2 --no-figures

RUN useradd --create-home --uid 10001 app && chown -R app /app /tmp/numba-cache 2>/dev/null || true
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health')" || exit 1
CMD ["sh", "-c", "pratibimb serve --profile ${PRATIBIMB_PROFILE} --port ${PORT}"]
