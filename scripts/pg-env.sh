#!/usr/bin/env bash
# User-space PostgreSQL 17 environment for PrintShop staging validation.
#
# This sets up a real PostgreSQL server (downloaded as .deb packages and
# extracted to /tmp/pg-install/pgroot, no root required) running on 127.0.0.1:5433.
#
# Source this file before running any psql / prisma / pg_dump command:
#   source /home/z/my-project/scripts/pg-env.sh
#
# The server is initialized with --auth=trust over the loopback, so the
# `postgres` superuser has no password. This is ONLY acceptable because the
# server binds to 127.0.0.1 and the data dir lives in /tmp — i.e. a truly
# disposable, single-host, non-networked staging instance. NEVER use this
# configuration in a real networked environment.

export PGROOT=/tmp/pg-install/pgroot
export PATH="$PGROOT/usr/lib/postgresql/17/bin:$PATH"
export LD_LIBRARY_PATH="$PGROOT/usr/lib/x86_64-linux-gnu:$PGROOT/usr/lib/postgresql/17/lib:${LD_LIBRARY_PATH:-}"
export PGDATA=/tmp/pgdata
export PGHOST=127.0.0.1
export PGPORT=5433
export PGUSER=z
# The connection string used by Prisma and the app
export DATABASE_URL="postgresql://z@127.0.0.1:5433/printshop_staging?schema=public"
# Keep the SQLite URL around so we don't accidentally break the dev DB
export SQLITE_DATABASE_URL="file:/home/z/my-project/db/custom.db"
