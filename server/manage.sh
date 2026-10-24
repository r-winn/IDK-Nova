#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo='r-winn/IDK-Nova'
export NOVA_CONFIG_DIR="$root/config"
preflight() {
  if [[ -f "$root/config/compose.override.yaml" ]] && grep -q 'onprem/Caddyfile' "$root/config/compose.override.yaml"; then
    for name in tls/server.crt tls/server.key ca/company-ca.pem; do
      [[ -s "$root/config/$name" ]] || { printf 'Missing corporate certificate file: config/%s. Read onprem/README.fa.md before starting.\n' "$name" >&2; return 1; }
    done
  fi
}
compose() {
  local release="$1"; shift
  local compose_args=(--env-file "$root/config/.env" -p idk-nova -f "$release/compose.yaml")
  if [[ -f "$root/config/compose.override.yaml" ]]; then compose_args+=(-f "$root/config/compose.override.yaml"); fi
  NOVA_VERSION="$(<"$release/VERSION")" docker compose "${compose_args[@]}" "$@"
}
activate() {
  local release="$1" previous
  previous="$(readlink -f "$root/current")"
  preflight
  compose "$release" build --pull nova
  if ! compose "$release" up -d --wait --wait-timeout 180; then
    echo 'New version did not become healthy; restoring the previous deployment.' >&2
    compose "$previous" up -d --no-build --wait --wait-timeout 180
    return 1
  fi
  ln -sfn "$previous" "$root/previous"
  ln -sfn "$release" "$root/current"
  cp "$release/manage.sh" "$root/manage.sh.next"
  chmod 755 "$root/manage.sh.next"
  mv "$root/manage.sh.next" "$root/manage.sh"
  echo 'Ready. Existing browser sessions may need to sign in again; configuration was preserved.'
}
case "${1:-help}" in
  check)
    current="$(<"$root/current/VERSION")"
    metadata="$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 "https://api.github.com/repos/$repo/releases?per_page=100")"
    latest="$(printf '%s\n' "$metadata" | sed -nE 's/.*"tag_name": "server-(v[0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' | head -1)"
    [[ "$latest" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Could not determine the latest release.' >&2; exit 1; }
    printf 'Installed: v%s\nLatest published release: %s\n' "$current" "$latest"
    if [[ "$latest" != "v$current" && "$(printf '%s\n' "$current" "${latest#v}" | sort -V | tail -1)" == "${latest#v}" ]] && grep -Fq "\"name\": \"IDK-Nova-Server-${latest#v}.tar.gz\"" <<< "$metadata"; then
      printf 'To install: %s/manage.sh update %s\n' "$root" "$latest"
    else
      echo 'No newer server bundle is listed in the latest published release.'
    fi
    ;;
  start) preflight; compose "$(readlink -f "$root/current")" build --pull nova; compose "$(readlink -f "$root/current")" up -d --wait --wait-timeout 180 ;;
  stop) compose "$(readlink -f "$root/current")" stop ;;
  status) compose "$(readlink -f "$root/current")" ps ;;
  logs) compose "$(readlink -f "$root/current")" logs --tail 100 -f ;;
  rollback) [[ -L "$root/previous" ]] || { echo 'No previous deployment.' >&2; exit 1; }; activate "$(readlink -f "$root/previous")" ;;
  use)
    version="${2:-}"
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && -f "$root/releases/$version/VERSION" ]] || { echo 'Specify an already installed version, e.g. manage.sh use 0.31.1' >&2; exit 1; }
    [[ "$(<"$root/releases/$version/VERSION")" == "$version" ]] || { echo 'Installed version metadata does not match the selected directory.' >&2; exit 1; }
    activate "$(readlink -f "$root/releases/$version")"
    ;;
  update)
    tag="${2:-}"
    [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Specify a released version, e.g. manage.sh update v0.31.0' >&2; exit 1; }
    version="${tag#v}"; target="$root/releases/$version"
    [[ ! -e "$target" ]] || { echo 'Version directory already exists. Inspect it before retrying.' >&2; exit 1; }
    stage="$(mktemp -d "$root/.download.XXXXXX")"
    # Temporary download is retained on failure for diagnosis, never remove config/data.
    asset="IDK-Nova-Server-$version.tar.gz"
    base="https://github.com/$repo/releases/download/server-$tag"
    curl --fail --location --proto '=https' --tlsv1.2 --retry 3 "$base/$asset" -o "$stage/$asset"
    curl --fail --location --proto '=https' --tlsv1.2 --retry 3 "$base/$asset.sha256" -o "$stage/$asset.sha256"
    expected="$(awk 'NR==1 {print $1}' "$stage/$asset.sha256")"
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid checksum file.' >&2; exit 1; }
    actual="$(sha256sum "$stage/$asset" | awk '{print $1}')"
    [[ "$actual" == "$expected" ]] || { echo 'Checksum mismatch; update cancelled.' >&2; exit 1; }
    # Archives are produced by our release job; still reject traversal, links, and special files.
    tar -tzf "$stage/$asset" | awk '/(^\/|(^|\/)\.\.(\/|$))/ {bad=1} END {exit bad}'
    tar -tvzf "$stage/$asset" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit bad}'
    mkdir "$stage/release"
    tar -xzf "$stage/$asset" -C "$stage/release" --no-same-owner --no-same-permissions
    [[ "$(<"$stage/release/VERSION")" == "$version" ]] || { echo 'Version mismatch.' >&2; exit 1; }
    mv "$stage/release" "$target"
    activate "$target"
    ;;
  *) echo 'Usage: manage.sh {start|stop|status|logs|check|update vX.Y.Z|use X.Y.Z|rollback}' ;;
esac
