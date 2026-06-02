#!/bin/sh
set -eu

APP_UID="${PI_WEB_UID:-1000}"
APP_GID="${PI_WEB_GID:-1000}"

mkdir -p /home/piweb/.pi/agent /workspace

# Mounted host config directories may be created as root by Docker. Fix only
# the Pi config mount; /home/piweb/.ssh is often mounted read-only.
chown -R "${APP_UID}:${APP_GID}" /home/piweb/.pi

exec gosu "${APP_UID}:${APP_GID}" "$@"
