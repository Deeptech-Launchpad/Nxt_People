#!/bin/sh
# Run migrations, then exec the server. dumb-init (set as ENTRYPOINT in the
# Dockerfile) wraps this script so signals are forwarded correctly.
#
# Set RUN_MIGRATIONS=false to skip — useful if migrations were already run
# externally and you just want to bounce the app container.

set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo ">>> Running database migrations..."
  node migrate.js
  echo ">>> Migrations complete."
else
  echo ">>> RUN_MIGRATIONS=false — skipping migrations."
fi

echo ">>> Starting server..."
exec node server.js
