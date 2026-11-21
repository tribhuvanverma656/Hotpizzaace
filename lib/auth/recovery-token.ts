/** Token hashes are private bearer credentials, even though their values are hashed. */
export function validRecoveryTokenHash(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

/** Only the URL fragment is accepted; it is never sent in an HTTP request. */
export function readRecoveryFragment(fragment: string): string | null {
  if (!fragment.startsWith('#') || fragment.length > 1024) return null;
  const parameters = new URLSearchParams(fragment.slice(1));
  if (
    parameters.getAll('token_hash').length !== 1 ||
    parameters.getAll('type').length !== 1 ||
    [...parameters.keys()].some((key) => key !== 'token_hash' && key !== 'type') ||
    parameters.get('type') !== 'recovery'
  )
    return null;
  const tokenHash = parameters.get('token_hash');
  return validRecoveryTokenHash(tokenHash) ? tokenHash : null;
}
