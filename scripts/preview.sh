#!/usr/bin/env bash
# A local preview of the console with sample data, for working on the UI without touching the live Worker or its
# database. Builds a throwaway D1 under .wrangler/preview (schema + every migration + scripts/preview-seed.mjs) the
# first time, then runs `wrangler dev --local`. Log in at http://localhost:8791/login with the password in .dev.vars
# (created here if missing; preview only, git-ignored).
#
#   bash scripts/preview.sh           # start (builds the sample database if it isn't there)
#   bash scripts/preview.sh --reset   # rebuild the sample database first
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install --no-audit --no-fund
DIR=.wrangler/preview
DB="$(node -e 'console.log(require("fs").readFileSync("wrangler.jsonc","utf8").match(/"database_name":\s*"([^"]+)"/)[1])')"
if [ "${1:-}" = "--reset" ] || [ ! -f "$DIR/seeded" ]; then
  rm -rf "$DIR" && mkdir -p "$DIR"
  run() { npx wrangler d1 execute "$DB" --local --persist-to "$DIR" -y "$@" >/dev/null; }
  run --file schema.sql
  # Byte order, same as scripts/setup.mjs and the tests (JavaScript sort). A locale like en_US
  # sorts automations_2.sql before automations.sql, and the later file inserts columns the earlier one adds.
  while IFS= read -r f; do run --file "$f"; done < <(printf '%s\n' migrations/*.sql | LC_ALL=C sort)
  node scripts/preview-seed.mjs > "$DIR/seed.sql"
  run --file "$DIR/seed.sql"
  touch "$DIR/seeded"
fi
if [ ! -f .dev.vars ]; then
  printf 'ADMIN_PASSWORD=preview-%s\nREVIEW_PASSWORD=preview-review\nINBOUND_SECRET=dev\nMETA_VERIFY_TOKEN=dev\nMETA_APP_SECRET=dev-app-secret\nANTHROPIC_API_KEY=dev\n' "$(openssl rand -hex 6)" > .dev.vars
  echo "Created .dev.vars: the preview's login password is its ADMIN_PASSWORD."
fi
exec npx wrangler dev --local --port "${PORT:-8791}" --persist-to "$DIR"
