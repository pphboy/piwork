# syntax=docker/dockerfile:1
ARG PYTHON_IMAGE=python:3.13-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641
FROM ${PYTHON_IMAGE}
ARG SQLITE3_VERSION=3.40.1-2+deb12u2
ARG PIWORK_COMMIT
ARG PIWORK_MODIFIED
ARG PIWORK_WEB_INPUT_HASH
LABEL org.opencontainers.image.title="Piwork FastAPI htmx base" \
      org.opencontainers.image.revision="${PIWORK_COMMIT}" \
      io.piwork.source.modified="${PIWORK_MODIFIED}" \
      io.piwork.web-base.contract="1" \
      io.piwork.web-base.stack="python-fastapi-htmx-sqlite" \
      io.piwork.web-base.input-sha256="${PIWORK_WEB_INPUT_HASH}"
RUN apt-get update \
 && apt-get install -y --no-install-recommends "sqlite3=${SQLITE3_VERSION}" ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY fastapi-htmx-base/requirements.lock fastapi-htmx-base/environment.json /opt/piwork-web-base/
RUN python -m pip download --only-binary=:all: --require-hashes -r /opt/piwork-web-base/requirements.lock -d /tmp/wheels \
 && python -m pip install --no-index --require-hashes --no-cache-dir --find-links /tmp/wheels -r /opt/piwork-web-base/requirements.lock \
 && rm -rf /tmp/wheels
COPY --chmod=0644 web-common/*.py fastapi-htmx-base/tools/*.py /opt/piwork-web-base/lib/
COPY --chmod=0644 fastapi-htmx-base/vendor/ /opt/piwork-web-base/vendor/
COPY --chmod=0755 fastapi-htmx-base/tools/piwork-fastapi /usr/local/bin/piwork-fastapi
RUN python /opt/piwork-web-base/lib/freeze_fastapi.py \
 && chmod -R a+rX /opt/piwork-web-base \
 && mkdir -p /var/data/workspace && chown 10001:10001 /var/data/workspace
ENV PYTHONPATH=/opt/piwork-web-base/lib \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONNOUSERSITE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /var/data/workspace
USER 10001:10001
EXPOSE 8080
CMD ["piwork-fastapi", "run"]
