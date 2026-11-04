#!/bin/sh
# Runs Prisma migrations against the DIRECT database URL.
# Neon pooled URLs don't support migrations; use DATABASE_URL_DIRECT when set.
set -e
if [ -n "$DATABASE_URL_DIRECT" ]; then
  echo "Using DATABASE_URL_DIRECT for migrations"
  DATABASE_URL="$DATABASE_URL_DIRECT" npx prisma migrate deploy
else
  npx prisma migrate deploy
fi
