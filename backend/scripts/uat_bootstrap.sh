#!/bin/sh
# Used only by the task-owned disposable UAT containers. Never reads host .env.
set -eu
test "${DB_DATABASE:-}" = rematch_stage4_test
test "${REMATCH_REVIEW_TEST:-}" = isolated-stage4
mkdir -p /tmp/app
for path in app config routes bootstrap public database scripts tests; do
  cp -R /workspace/$path /tmp/app/$path
done
cp /workspace/artisan /workspace/composer.json /tmp/app/
cp -R /var/www/html/vendor /tmp/app/vendor
rm -f /tmp/app/bootstrap/cache/*.php
mkdir -p /tmp/app/storage/framework/cache/data /tmp/app/storage/framework/sessions /tmp/app/storage/framework/views /tmp/app/storage/logs /tmp/app/storage/app/private
cp -R /workspace/storage/app/wilayah /tmp/app/storage/app/wilayah
touch /tmp/app/.env
cd /tmp/app
exec "$@"
