/*
 * Recordings live in IndexedDB: too big for localStorage, and they stay on
 * this phone. The project only keeps a voice's id, so undo can bring an older
 * take back; the oldest takes beyond a dozen are cleared away.
 */

export interface StoredTake {
  id: string;
  samples: Float32Array;
  sampleRate: number;
  createdAt: number;
}

const DATABASE = "jackpop";
const STORE = "voices";
const KEEP = 12;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is not available"));
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function saveTake(take: StoredTake): Promise<void> {
  const database = await openDatabase();
  try {
    const store = database.transaction(STORE, "readwrite").objectStore(STORE);
    await done(store.put(take));
    const all = (await done(store.getAll())) as StoredTake[];
    const old = all.sort((a, b) => b.createdAt - a.createdAt).slice(KEEP);
    for (const entry of old) await done(store.delete(entry.id));
  } finally {
    database.close();
  }
}

export async function loadTake(id: string): Promise<StoredTake | null> {
  const database = await openDatabase();
  try {
    const take = (await done(database.transaction(STORE, "readonly").objectStore(STORE).get(id))) as StoredTake | undefined;
    return take ?? null;
  } finally {
    database.close();
  }
}
