function enabled(env, flag, settings) {
  const value = env[flag]?.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value) throw new Error(`${flag} must be true or false.`);
  return settings.some(key => Boolean(env[key]?.trim()));
}

export function contextQualificationEnabled(env = process.env) {
  return enabled(env, 'GITHUB_CONTEXT_E2E_ENABLED', [
    'GITHUB_CONTEXT_DEFINITION_ID', 'GITHUB_CONTEXT_EMPTY_ISSUE_URL',
    'GITHUB_CONTEXT_PAGED_ISSUE_URL', 'GITHUB_CONTEXT_GATEWAY_RECEIPT',
    'GITHUB_CONTEXT_TOOL_NAME',
  ]);
}

export function dispatchQualificationEnabled(env = process.env) {
  return enabled(env, 'GITHUB_API_DISPATCH_QUALIFICATION_ENABLED', [
    'GITHUB_API_DISPATCH_IDENTITY_FILE',
  ]);
}
