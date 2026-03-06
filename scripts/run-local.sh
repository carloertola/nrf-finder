#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/pwa"

echo "Starting NRF Finder PWA on http://localhost:8080"
python3 -m http.server 8080
