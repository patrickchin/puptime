import { z } from 'zod';

const diagnostic = z.object({
  event: z.enum(['request', 'sync']),
  result: z.enum(['started', 'success', 'error', 'cancelled', 'paused', 'idle']),
  route: z.enum(['config', 'account', 'enroll', 'push', 'pull', 'history', 'photo-upload', 'photo-download']).optional(),
  method: z.enum(['GET', 'POST']).optional(),
  status: z.number().int().min(0).max(599).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  category: z.enum(['network', 'invalid-request', 'invalid-response', 'auth-required', 'forbidden', 'conflict', 'account-deleted', 'rate-limited', 'server-error', 'local-storage']).optional(),
  state: z.enum(['idle', 'synced', 'pending', 'blocked', 'auth-required', 'retry', 'error']).optional(),
  pending: z.number().int().min(0).max(1_000_000).optional(),
  blocked: z.number().int().min(0).max(1_000_000).optional(),
  batchCount: z.number().int().min(0).max(50).optional(),
});
const entry = diagnostic.extend({ at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
export type CloudDiagnosticInput = z.input<typeof diagnostic>;
export type RecordCloudDiagnostic = (input: CloudDiagnosticInput) => void;
type DiagnosticEntry = z.infer<typeof entry>;
type DiagnosticStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> };
const storageKey = 'puptime.sync.diagnostics.v1';
const limit = 100;

// Device-only support history. Never pass request bodies, errors or identities.
export function createSyncDiagnostics(storage: DiagnosticStorage, now = Date.now) {
  let entries: DiagnosticEntry[] = [], dirty = false, saving: Promise<void> | null = null;
  const loaded = Promise.resolve().then(() => storage.getItem(storageKey)).then(raw => {
    if (!raw || raw.length > 100_000) return;
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return;
    const safe = saved.slice(-limit).flatMap(value => { const parsed = entry.safeParse(value); return parsed.success ? [parsed.data] : []; });
    entries = [...safe, ...entries].slice(-limit);
  }).catch(() => {});
  function persist() {
    dirty = true;
    if (saving) return;
    saving = loaded.then(async () => {
      while (dirty) {
        dirty = false;
        try { await storage.setItem(storageKey, JSON.stringify(entries)); } catch { /* Diagnostics never block or break sync. */ }
      }
    }).finally(() => { saving = null; if (dirty) persist(); });
  }
  const record: RecordCloudDiagnostic = input => {
    try {
      const parsed = entry.safeParse({ ...input, at: now() });
      if (!parsed.success) return;
      entries = [...entries, parsed.data].slice(-limit);
      persist();
    } catch { /* Support logging is best effort. */ }
  };
  return {
    record,
    async read() { await loaded; return entries.map(value => entry.parse(value)); },
    async flush() { await loaded; await saving; },
  };
}
