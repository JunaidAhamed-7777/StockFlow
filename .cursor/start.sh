#!/usr/bin/env bash
# StockFlow Cloud Agent start script.
# Idempotent per-boot reconciliation: ensures the local PostgreSQL cluster is
# running and ready. The API and web servers run in named terminals.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PG_VERSION=16
PGBIN="/usr/lib/postgresql/${PG_VERSION}/bin"
DATADIR="$ROOT/server/.pgdata"
PGPORT=5435
PGUSER=stockflow

if [ ! -x "$PGBIN/pg_ctl" ]; then
  echo "PostgreSQL ${PG_VERSION} is not installed; run the install script first." >&2
  exit 1
fi

if ! "$PGBIN/pg_ctl" -D "$DATADIR" status >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$DATADIR" -l "$DATADIR/server.log" \
    -o "-p ${PGPORT} -c listen_addresses='127.0.0.1' -c unix_socket_directories='$DATADIR'" start
fi

for _ in $(seq 1 30); do
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
    echo "PostgreSQL is ready on port ${PGPORT}"
    exit 0
  fi
  sleep 1
done

echo "PostgreSQL did not become ready in time" >&2
exit 1
