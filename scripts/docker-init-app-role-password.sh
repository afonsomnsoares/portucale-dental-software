#!/bin/sh
# Runs as a Postgres init script (see docker-compose.yml's `postgres` service
# volumes — mounted after 01-schema.sql, which creates the `portucale_app`
# role but deliberately never sets its password inline). Only fires on first
# container start against an empty data volume, same as every other
# /docker-entrypoint-initdb.d/ script.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  ALTER ROLE portucale_app PASSWORD '${POSTGRES_APP_PASSWORD}';
EOSQL
