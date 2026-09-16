#!/usr/bin/env bash
# StockFlow Cloud Agent install script.
# Idempotent: refreshes dependencies, ensures a local PostgreSQL cluster and
# database exist, applies the Prisma schema, and seeds development data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PG_VERSION=16
PGBIN="/usr/lib/postgresql/${PG_VERSION}/bin"
DATADIR="$ROOT/server/.pgdata"
PGPORT=5435
PGUSER=stockflow
PGPASSWORD_VALUE=StockFlow_Dev2026
PGDB=stock_management

echo "==> Ensuring environment files exist"
[ -f server/.env ] || cp server/.env.example server/.env
[ -f client/.env ] || cp client/.env.example client/.env

echo "==> Ensuring PostgreSQL ${PG_VERSION} is installed"
if [ ! -x "$PGBIN/initdb" ]; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

echo "==> Installing workspace dependencies"
npm install

echo "==> Ensuring PostgreSQL cluster exists"
if [ ! -f "$DATADIR/PG_VERSION" ]; then
  PWFILE="$(mktemp)"
  printf '%s' "$PGPASSWORD_VALUE" > "$PWFILE"
  "$PGBIN/initdb" --pgdata "$DATADIR" --username "$PGUSER" \
    --pwfile "$PWFILE" --auth scram-sha-256 --encoding UTF8 --locale C
  rm -f "$PWFILE"
fi

echo "==> Starting PostgreSQL on port ${PGPORT}"
if ! "$PGBIN/pg_ctl" -D "$DATADIR" status >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$DATADIR" -l "$DATADIR/server.log" \
    -o "-p ${PGPORT} -c listen_addresses='127.0.0.1' -c unix_socket_directories='$DATADIR'" start
fi

for _ in $(seq 1 30); do
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "==> Ensuring database '${PGDB}' exists"
export PGPASSWORD="$PGPASSWORD_VALUE"
if ! "$PGBIN/psql" -w -U "$PGUSER" -h 127.0.0.1 -p "$PGPORT" -d postgres \
      -tAc "SELECT 1 FROM pg_database WHERE datname='${PGDB}'" | grep -q 1; then
  "$PGBIN/psql" -w -U "$PGUSER" -h 127.0.0.1 -p "$PGPORT" -d postgres \
    -c "CREATE DATABASE ${PGDB};"
fi

echo "==> Applying Prisma schema and seeding"
cd "$ROOT/server"
npx prisma generate
npx prisma db push --skip-generate
npm run seed

echo "==> Install complete"
