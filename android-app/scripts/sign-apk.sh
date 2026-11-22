#!/usr/bin/env bash
# sign-apk.sh — sign + zipalign the release APK.
#
# This script is now mostly a no-op because the Gradle build already signs
# the release APK via the signingConfigs.release block in app/build.gradle.
# It remains as a manual fallback for signing an unsigned APK (e.g. if the
# Gradle signing config is removed or you want to re-sign with a different
# keystore).
#
# Usage:
#   bash scripts/sign-apk.sh
#
# Environment variables:
#   PRINTSHOP_KEYSTORE_PASSWORD  (default: printshop-companion-2026)
#   PRINTSHOP_KEY_PASSWORD       (default: printshop-companion-2026)
#
# Requires: Android build-tools (zipalign + apksigner) — installed via
# `sdkmanager "build-tools;33.0.2"`.

set -euo pipefail
cd "$(dirname "$0")/.."

KEYSTORE="scripts/keystore/printshop-release.keystore"
STOREPASS="${PRINTSHOP_KEYSTORE_PASSWORD:-printshop-companion-2026}"
KEYPASS="${PRINTSHOP_KEY_PASSWORD:-printshop-companion-2026}"
ALIAS="printshop-release"

# Locate the unsigned release APK.
UNSIGNED_APK="android/app/build/outputs/apk/release/app-release-unsigned.apk"
SIGNED_APK="android/app/build/outputs/apk/release/printshop-companion-v1.0.apk"

if [ ! -f "$UNSIGNED_APK" ]; then
  echo "sign-apk: unsigned APK not found at $UNSIGNED_APK"
  echo "  Run `npm run build:apk` first (or `./gradlew assembleRelease`)."
  exit 1
fi

# Locate the Android build-tools (zipalign + apksigner).
BUILD_TOOLS_DIR="${ANDROID_HOME:-$HOME/android-sdk}/build-tools/33.0.2"
ZIPALIGN="$BUILD_TOOLS_DIR/zipalign"
APKSIGNER="$BUILD_TOOLS_DIR/apksigner"

if [ ! -f "$ZIPALIGN" ] || [ ! -f "$APKSIGNER" ]; then
  echo "sign-apk: build-tools 33.0.2 not found at $BUILD_TOOLS_DIR"
  echo "  Run: sdkmanager \"build-tools;33.0.2\""
  exit 1
fi

echo "sign-apk: zipalign + signing $UNSIGNED_APK"

# Step 1: zipalign (4-byte alignment for memory-mapped reads → faster app start).
"$ZIPALIGN" -f 4 "$UNSIGNED_APK" "$SIGNED_APK.tmp"

# Step 2: sign with apksigner (v2+ signing scheme — required for Android 7+).
"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-pass "pass:$STOREPASS" \
  --key-pass "pass:$KEYPASS" \
  --ks-key-alias "$ALIAS" \
  --out "$SIGNED_APK" \
  "$SIGNED_APK.tmp"

rm -f "$SIGNED_APK.tmp"

# Step 3: verify the signature.
"$APKSIGNER" verify --verbose "$SIGNED_APK" 2>&1 | tail -5

echo ""
echo "sign-apk: ✓ signed APK ready at:"
echo "  $SIGNED_APK"
echo "  ($(du -h "$SIGNED_APK" | cut -f1))"
echo ""
echo "SHA-256 checksum:"
shasum -a 256 "$SIGNED_APK" | awk '{print "  "$1}'
