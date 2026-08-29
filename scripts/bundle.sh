#!/usr/bin/env bash
# Concatenates the repository into one file, for review by a person or a model
# that cannot clone it.
#
#   ./scripts/bundle.sh              # source only, no tests
#   ./scripts/bundle.sh --tests      # include the test suite
#
# Only tracked files are included, so anything gitignored - .env, node_modules,
# build output - cannot leak into the bundle by accident. Lockfiles are skipped
# because they are enormous and say nothing about the design, and binaries
# because concatenating a favicon into a text file produces a megabyte of
# mojibake and no information.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_TESTS=0
[ "${1:-}" = "--tests" ] && WITH_TESTS=1

OUT="${OUT:-$ROOT/vbb-bundle.md}"

files() {
  git ls-files \
    | grep -vE '(^|/)package-lock\.json$' \
    | grep -vE '(^|/)vbb-bundle.*\.md$' \
    | grep -viE '\.(ico|png|jpe?g|gif|webp|avif|woff2?|ttf|eot|pdf|zip)$' \
    | { if [ "$WITH_TESTS" = "1" ]; then cat; else grep -vE '\.test\.(ts|tsx)$|/tests?/'; fi; }
}

{
  echo "# VBB Engine - full source bundle"
  echo
  echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) from commit $(git rev-parse --short HEAD)."
  if [ "$WITH_TESTS" = "1" ]; then
    echo "Includes the test suite."
  else
    echo "Source only - tests excluded. Re-run with --tests to include them."
  fi
  echo
  echo "Read CLAUDE.md first: it states the binding principles the rest of the"
  echo "code is written to serve, and most design decisions only make sense"
  echo "against them."
  echo
  echo "## Files"
  echo
  files | sed 's/^/- /'
  echo
  echo "---"
  echo

  while IFS= read -r f; do
    case "$f" in
      *.ts|*.tsx)  lang=typescript ;;
      *.js)        lang=javascript ;;
      *.sql)       lang=sql ;;
      *.json)      lang=json ;;
      *.css)       lang=css ;;
      *.sh)        lang=bash ;;
      *.md)        lang=markdown ;;
      *)           lang="" ;;
    esac
    echo "## $f"
    echo
    echo '```'"$lang"
    cat "$f"
    echo '```'
    echo
  done < <(files)
} > "$OUT"

printf 'wrote %s - %s bytes, %s files, roughly %s tokens\n' \
  "$OUT" "$(wc -c < "$OUT")" "$(files | wc -l)" "$(( $(wc -c < "$OUT") / 4 ))"
