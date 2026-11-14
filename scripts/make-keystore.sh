#!/usr/bin/env bash
# Creates the one signing key for Log/Plan. Run once, keep the file and passwords safe, never commit them.
# Losing this key means future builds cannot update the installed app (Android would require an uninstall).
set -euo pipefail
OUT="${1:-$HOME/logplan-release.keystore}"
ALIAS="logplan"
if [ -e "$OUT" ]; then echo "Refusing to overwrite existing $OUT"; exit 1; fi
read -r -s -p "Choose a keystore password (min 6 characters): " PASS; echo
keytool -genkeypair -v -keystore "$OUT" -storetype PKCS12 -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10950 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Log/Plan, O=Personal"
echo
echo "Keystore: $OUT"
echo "SHA-1 (register this in Google Cloud for the Android OAuth client):"
keytool -list -v -keystore "$OUT" -alias "$ALIAS" -storepass "$PASS" | grep "SHA1:"
echo
echo "GitHub secrets to add (Settings > Secrets and variables > Actions):"
echo "  LP_KEYSTORE_BASE64   = output of: base64 -w0 \"$OUT\""
echo "  LP_KEYSTORE_PASSWORD = the password you just chose"
echo "  LP_KEY_ALIAS         = $ALIAS"
echo "  LP_KEY_PASSWORD      = the same password"
echo
echo "For local builds, create android/keystore.properties (it is git-ignored):"
printf '  storeFile=%s\n  storePassword=<password>\n  keyAlias=%s\n  keyPassword=<password>\n' "$OUT" "$ALIAS"
