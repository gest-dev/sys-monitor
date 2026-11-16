#!/usr/bin/env bash
set -euo pipefail
pasta="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
gjs -m "$pasta/tests/run.js"
gjs -m "$pasta/tests/system.js"
glib-compile-schemas --strict --dry-run "$pasta/extension/schemas"
schemas_teste="$(mktemp -d)"
trap 'rm -rf -- "$schemas_teste"' EXIT
cp "$pasta/extension/schemas/"*.xml "$schemas_teste/"
glib-compile-schemas --strict "$schemas_teste"
GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR="$schemas_teste" gjs -m "$pasta/tests/settings.js"
mkdir -p "$pasta/dist"
gnome-extensions pack --force --extra-source=network.js --extra-source=system.js --extra-source=icons --out-dir="$pasta/dist" "$pasta/extension"
echo "Pacote pronto em $pasta/dist/medidor-rede@gezer.local.shell-extension.zip"
