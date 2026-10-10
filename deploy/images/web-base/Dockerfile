# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG PYTHON_IMAGE=python:3.13-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641
FROM ${NODE_IMAGE} AS frontend
WORKDIR /opt/piwork-web-base/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --cache /opt/piwork-web-base/npm-cache --no-audit --no-fund

FROM ${PYTHON_IMAGE}
ARG SQLITE3_VERSION=3.40.1-2+deb12u2
ARG PIWORK_COMMIT
ARG PIWORK_MODIFIED
ARG PIWORK_WEB_INPUT_HASH
LABEL org.opencontainers.image.title="Piwork Web base" \
      org.opencontainers.image.revision="${PIWORK_COMMIT}" \
      io.piwork.source.modified="${PIWORK_MODIFIED}" \
      io.piwork.web-base.contract="1" \
      io.piwork.web-base.input-sha256="${PIWORK_WEB_INPUT_HASH}"
RUN apt-get update \
 && apt-get install -y --no-install-recommends "sqlite3=${SQLITE3_VERSION}" libstdc++6 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=frontend /opt/piwork-web-base/ /opt/piwork-web-base/
COPY requirements.lock environment.json /opt/piwork-web-base/
RUN python -m pip download --only-binary=:all: --require-hashes \
      -r /opt/piwork-web-base/requirements.lock -d /opt/piwork-web-base/wheels \
 && python -m pip install --no-index --require-hashes \
      --find-links /opt/piwork-web-base/wheels -r /opt/piwork-web-base/requirements.lock \
 && python -c 'import json,os,pathlib; p=pathlib.Path("/opt/piwork-web-base/environment.json"); v=json.loads(p.read_text()); v["inputHash"]=os.environ["PIWORK_WEB_INPUT_HASH"]; p.write_text(json.dumps(v,sort_keys=True)+"\n")'
COPY tools/*.py /opt/piwork-web-base/lib/
COPY --chmod=0755 tools/piwork-web /usr/local/bin/piwork-web
ENV PYTHONPATH=/opt/piwork-web-base/lib \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/opt/piwork-web-base/frontend/node_modules/.bin:$PATH
RUN mkdir -p /var/data/workspace && chown 10001:10001 /var/data/workspace
WORKDIR /var/data/workspace
USER 10001:10001
EXPOSE 8080
CMD ["piwork-web", "run"]
