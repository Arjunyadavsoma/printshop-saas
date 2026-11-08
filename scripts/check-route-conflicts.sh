#!/usr/bin/env bash
# check-route-conflicts.sh — detect Next.js App Router dynamic route conflicts.
#
# Next.js requires that sibling dynamic segments (e.g. [id] and [jobId])
# in the same directory level use the SAME slug name. Having different
# names causes: "Error: You cannot use different slug names for the same
# dynamic path ('id' !== 'jobId')" — which crashes the ENTIRE app.
#
# This script scans src/app/ for such conflicts.
# Exit 0 = no conflicts; exit 1 = conflict found.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Scanning src/app/ for dynamic route conflicts..."

# Find all directories that contain subdirectories with dynamic segment names
# Dynamic segments are directory names matching [name]
CONFLICTS_FOUND=0

# For each directory that contains dynamic-segment subdirectories,
# check if there are multiple DIFFERENT slug names at the same level.
find src/app -type d | while read -r dir; do
  # Find dynamic segment directories at this level
  children=$(ls -1 "$dir" 2>/dev/null | grep '^\[' || true)
  if [ -z "$children" ]; then
    continue
  fi

  # Extract the slug names (content between [ and ])
  slugs=$(echo "$children" | sed -E 's/^\[([^\]]+)\]$/\1/' | sort -u)

  # Count unique slug names
  count=$(echo "$slugs" | wc -l | tr -d ' ')

  if [ "$count" -gt 1 ]; then
    echo "❌ CONFLICT in $dir/"
    echo "   Multiple dynamic segment names found:"
    echo "$children" | sed 's/^/     - /'
    echo ""
    echo "   Next.js requires ALL sibling dynamic segments to use the SAME name."
    echo "   Fix: rename all dynamic directories in this path level to use one name."
    echo ""
    CONFLICTS_FOUND=1
  fi
done

# Re-check (the while loop runs in a subshell, so CONFLICTS_FOUND doesn't propagate)
CONFLICTS=$(find src/app -type d | while read -r dir; do
  children=$(ls -1 "$dir" 2>/dev/null | grep '^\[' || true)
  [ -z "$children" ] && continue
  slugs=$(echo "$children" | sed -E 's/^\[([^\]]+)\]$/\1/' | sort -u)
  count=$(echo "$slugs" | wc -l | tr -d ' ')
  [ "$count" -gt 1 ] && echo "$dir"
done)

if [ -n "$CONFLICTS" ]; then
  echo ""
  echo "❌ Dynamic route conflicts found in:"
  echo "$CONFLICTS" | sed 's/^/   - /'
  echo ""
  echo "This WILL crash the Next.js app at build time."
  echo "Fix: ensure all sibling [slug] directories use the same slug name."
  exit 1
fi

echo "✅ No dynamic route conflicts found."
