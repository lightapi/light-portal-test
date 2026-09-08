#!/usr/bin/env bash
# Read-only authentication probes against an already activated required/optional policy.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/common.sh"
load_test_environment "$repo_root"
require_current_access_token
export PORTAL_ACCESS_TOKEN PORTAL_BASE_URL LLM_PUBLIC_ALIAS TLS_INSECURE
python3 - "${1:?usage: run-llm-ownership-auth-gate.sh required|optional}" <<'PY'
import json, os, ssl, sys, urllib.error, urllib.request
mode = sys.argv[1]
if mode not in ('required', 'optional'):
    raise SystemExit('Expected required or optional')
context = ssl._create_unverified_context() if os.environ.get('TLS_INSECURE','').lower() == 'true' else ssl.create_default_context()
body = json.dumps({'model':os.environ['LLM_PUBLIC_ALIAS'],'messages':[{'role':'user','content':'Reply with ownership verified.'}],'max_tokens':32,'stream':False}).encode()
def probe(headers):
    request=urllib.request.Request(os.environ['PORTAL_BASE_URL'].rstrip('/')+'/v1/chat/completions',data=body,headers={'Content-Type':'application/json',**headers})
    try:
        with urllib.request.urlopen(request,context=context,timeout=60) as response:
            return response.status,response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code,error.read().decode()
status, response=probe({'Authorization':'Bearer '+os.environ['PORTAL_ACCESS_TOKEN']})
expected=401 if mode=='required' else 200
assert status==expected, f'{mode} direct-user request expected {expected}, got {status}: {response[:500]}'
if mode=='required': assert json.loads(response)['error']['code'] in ('workload_token_required','authentication_error'),response
print(f'{mode}: direct-user request returned {status}')
if mode=='optional':
    status,response=probe({'Authorization':'Bearer '+os.environ['PORTAL_ACCESS_TOKEN'],'X-Scope-Token':'Bearer invalid-workload-token'})
    assert status==401,f'Invalid supplied workload credential expected 401, got {status}'
    print('optional: invalid supplied workload credential returned 401')
PY
