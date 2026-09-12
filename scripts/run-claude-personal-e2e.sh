#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Keep explicit caller settings when loading the private test environment.
mapfile -t names < <(compgen -A variable CLAUDE_E2E_ || true)
declare -A supplied=()
for name in "${names[@]}"; do supplied["$name"]="${!name}"; done
env_file="${LIGHT_PORTAL_ENV_FILE:-$HOME/.config/lightapi/light-portal.env}"
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi
for name in "${!supplied[@]}"; do
  printf -v "$name" '%s' "${supplied[$name]}"
  export "${name?}"
done
default_python=python3
if [[ -x "$repo_root/.venv-claude-e2e/bin/python" ]]; then
  default_python="$repo_root/.venv-claude-e2e/bin/python"
fi
exec "${CLAUDE_E2E_PYTHON:-$default_python}" "$repo_root/tests/claude-personal/run.py"
