#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repo_root/fixtures/tokens/manifest.json"

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }
jq -e '
  .schemaVersion == "1" and
  (.defaultProfile | type == "string") and
  (.profiles[.defaultProfile] | type == "object")
' "$manifest" >/dev/null

decode_payload() {
  local token="$1"
  local payload="${token#*.}"
  payload="${payload%%.*}"
  payload="${payload//-/+}"
  payload="${payload//_/\/}"
  case $((${#payload} % 4)) in
    0) ;;
    2) payload+="==" ;;
    3) payload+="=" ;;
    *) echo "invalid JWT payload encoding" >&2; return 1 ;;
  esac
  printf '%s' "$payload" | base64 --decode
}

while IFS= read -r profile; do
  file_name="$(jq -er --arg profile "$profile" '.profiles[$profile].file' "$manifest")"
  token_file="$repo_root/fixtures/tokens/$file_name"
  [[ -f "$token_file" ]] || { echo "missing token fixture for $profile: $file_name" >&2; exit 1; }
  token="$(tr -d '\r\n' <"$token_file")"
  [[ "$token" == *.*.* ]] || { echo "invalid JWT structure for $profile" >&2; exit 1; }
  claims="$(decode_payload "$token")"
  printf '%s' "$claims" | jq -e . >/dev/null

  expected="$(jq -c --arg profile "$profile" '.profiles[$profile].expectedClaims' "$manifest")"
  jq -e --argjson expected "$expected" '
    .iss == $expected.issuer and
    .aud == $expected.audience and
    .sub == $expected.subject and
    .client_id == $expected.clientId and
    (($expected.scopes - .scp) | length == 0) and
    ((.role | split(" ")) as $actual | (($expected.roles - $actual) | length == 0))
  ' <<<"$claims" >/dev/null || {
    echo "JWT claims do not match manifest for profile $profile" >&2
    exit 1
  }
done < <(jq -r '.profiles | keys[]' "$manifest")

echo "validated JWT fixture profiles"
