#!/bin/bash
set -euo pipefail

# Prevent running the build script as root. Running with sudo causes
# Bundler/system gem write attempts into system paths like /Library/Ruby/Gems
# which require elevated permissions. Prefer installing a user-owned Ruby
# (via rbenv or Homebrew) and running this script as a normal user.
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
	cat <<'EOF'
ERROR: Do not run this script with sudo/root.

This script should be run as your regular user. Running as root causes
Bundler and gem operations to try to write into system directories and
will require elevated permissions.

Recommended approaches:
	1) Install a user Ruby with rbenv (recommended):
			 brew install rbenv ruby-build
			 rbenv install 3.2.2
			 rbenv global 3.2.2
			 gem install bundler

	2) Or install Homebrew Ruby and add it to your PATH:
			 brew install ruby
			 # Add the line brew prints to your ~/.zshrc, for example:
			 export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
			 gem install bundler

After installing a user Ruby, re-run this script WITHOUT sudo:
	bash build.sh

EOF
	exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$REPO_ROOT"

# Ensure Ruby gems install into the local vendor directory so Firebase builds remain reproducible.
bundle config set --local path vendor/bundle >/dev/null
BUNDLE_GEMFILE="${REPO_ROOT}/site/Gemfile" bundle install --jobs=4 --retry=3

# Install/update Node dependencies for asset builds.
npm install

# Build the static site into ./_site using the project npm script.
rm -rf "${REPO_ROOT}/site/.jekyll-cache-build"
npm run build
npm run build
