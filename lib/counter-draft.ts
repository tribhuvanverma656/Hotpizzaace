// In-memory only: survive a temporary connection gate or route remount without
// writing customer details or payment references into browser storage.
const drafts = new Map<string, unknown>();
let verifiedIdentity: string | null | undefined;

export function noteCounterDraftIdentity(identity: string | null) {
  if (verifiedIdentity !== undefined && verifiedIdentity !== identity) drafts.clear();
  verifiedIdentity = identity;
}
export function readCounterDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}
export function writeCounterDraft<T>(key: string, value: T) {
  drafts.set(key, value);
}
