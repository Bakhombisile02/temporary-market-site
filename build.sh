#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$REPO_ROOT"

# Ensure Ruby gems install into the local vendor directory so Firebase builds remain reproducible.
bundle config set --local path vendor/bundle >/dev/null
BUNDLE_GEMFILE="${REPO_ROOT}/site/Gemfile" bundle install --jobs=4 --retry=3

# Install/update Node dependencies for asset builds.
npm install

# Build the static site into ./_site using the project npm script.
npm run build