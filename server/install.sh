#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="${1:-/opt/idk-nova}"
[[ "$root" == /* && "$root" != / && "$root" != "$HOME" ]] || { echo 'Choose an absolute dedicated install directory.' >&2; exit 1; }
version="$(<"$source_dir/VERSION")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
command -v docker >/dev/null
docker compose version >/dev/null
[[ ! -e "$root/releases/$version" ]] || { echo 'Version already installed. Use manage.sh.' >&2; exit 1; }
mkdir -p "$root/releases/$version" "$root/config"
chmod 700 "$root/config"
cp -a "$source_dir/." "$root/releases/$version/"
if [[ ! -f "$root/config/config.json" ]]; then
  cp "$source_dir/config.example.json" "$root/config/config.json"
  chmod 644 "$root/config/config.json"
fi
if [[ ! -f "$root/config/.env" ]]; then
  install -m 600 "$source_dir/.env.example" "$root/config/.env"
fi
cp "$source_dir/manage.sh" "$root/manage.sh"
chmod 755 "$root/manage.sh"
if [[ ! -e "$root/current" ]]; then ln -s "releases/$version" "$root/current"; fi
printf 'Installed %s into %s\nEdit config/config.json and config/.env, then run:\n  %s/manage.sh start\n' "$version" "$root" "$root"
