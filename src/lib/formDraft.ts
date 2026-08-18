// Local draft persistence for long forms.
//
// A user who spends fifteen minutes filling in the onboarding form, hits a
// failed submit and loses everything does not come back. Drafts are written to
// IndexedDB as the user types, so a crash, a refresh, a dead network or a
// closed laptop all resume where they left off.
//
// Why IndexedDB rather than localStorage: localStorage is synchronous (it
// blocks the main thread on every keystroke), caps at ~5MB across the whole
// origin, and holds strings only. IndexedDB is async and stores objects.
//
// ⚠️ This is a convenience cache on the USER'S machine, not storage. It is
// cleared on successful submit, and nothing here is a substitute for the
// server-side record.

const DB_NAME = 'primeos-drafts';
const STORE = 'drafts';
const DB_VERSION = 1;

// Drafts outlive a session but not a month — a stale draft silently overwriting
// fresh server state is worse than no draft at all.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface DraftRecord<T> {
  key: string;
  value: T;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb_open_failed'));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb()
    .then((db) => new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    }))
    // Private-browsing modes and storage-quota errors make IndexedDB throw.
    // A draft is a nicety — never let its failure break the form itself.
    .catch((e) => {
      console.warn('[formDraft] unavailable', e);
      return null;
    });
}

export async function saveDraft<T>(key: string, value: T): Promise<void> {
  const record: DraftRecord<T> = { key, value, savedAt: Date.now() };
  await run('readwrite', (store) => store.put(record));
}

export async function loadDraft<T>(key: string): Promise<T | null> {
  const record = await run<DraftRecord<T>>('readonly', (store) => store.get(key));
  if (!record) return null;
  if (Date.now() - record.savedAt > MAX_AGE_MS) {
    await clearDraft(key);
    return null;
  }
  return record.value;
}

export async function clearDraft(key: string): Promise<void> {
  await run('readwrite', (store) => store.delete(key));
}
