#!/bin/bash
# Bump a Cal Sans font version across font-proofer and wordmark.
#
# Usage:
#   ./bump-calsans.sh 1.910 1.911           # bumps CalSans (default)
#   ./bump-calsans.sh --ui 1.730 1.731      # bumps CalSansUI

set -e

PREFIX="CalSans"
if [[ "$1" == "--ui" ]]; then
  PREFIX="CalSansUI"
  shift
fi

OLD=$1
NEW=$2
AXES="[opsz,wght,GEOM,YTAS,SHRP]"

PROOFER=~/Documents/Github/font-proofer
WORDMARK=~/Documents/Github/wordmark

if [[ -z "$OLD" || -z "$NEW" ]]; then
  echo "Usage: ./bump-calsans.sh [--ui] <old-version> <new-version>"
  exit 1
fi

OLD_FILE="$PREFIX-VariableFont $OLD $AXES.ttf"
NEW_FILE="$PREFIX-VariableFont $NEW $AXES.ttf"

echo "Bumping $PREFIX $OLD → $NEW"
echo ""

bump_dir() {
  local dir=$1
  local font_dir=$2
  local label=$3

  echo "[$label] Updating references..."
  grep -rl "$PREFIX-VariableFont $OLD" "$dir" \
    --include="*.css" --include="*.jsx" --include="*.js" \
    | grep -v node_modules | grep -v ".next" | grep -v dist \
    | while read -r f; do
        sed -i '' "s/$PREFIX-VariableFont $OLD/$PREFIX-VariableFont $NEW/g" "$f"
        echo "  updated: $f"
      done

  echo "[$label] Renaming font file..."
  if [[ -f "$font_dir/$OLD_FILE" ]]; then
    mv "$font_dir/$OLD_FILE" "$font_dir/$NEW_FILE"
    echo "  renamed: $OLD_FILE → $NEW_FILE"
  else
    echo "  (font file not found at $font_dir/$OLD_FILE, skipping)"
  fi
}

bump_dir "$PROOFER" "$PROOFER/src/fonts" "font-proofer"
bump_dir "$WORDMARK" "$WORDMARK/fonts"   "wordmark"

echo ""
echo "Done. Verify changes then commit:"
echo "  cd $PROOFER && git add -A && git commit -m 'Bump $PREFIX to $NEW'"
echo "  cd $WORDMARK && git add -A && git commit -m 'Bump $PREFIX to $NEW'"
