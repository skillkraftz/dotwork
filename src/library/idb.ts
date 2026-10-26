import type { Backend, LibraryItem } from './library';

const DB = 'dotwork';
const STORE = 'library';

let connection: Promise<IDBDatabase> | null = null;

/** One connection is kept open, so that a write started when the tab is hidden does not first wait to open the database. */
function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => {
      req.result.onclose = req.result.onversionchange = () => { connection = null; req.result.close(); };
      resolve(req.result);
    };
    req.onerror = () => { connection = null; reject(req.error); };
  });
  return connection;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

/** The library kept in the browser's IndexedDB. */
export const idbBackend: Backend & { check(): Promise<void> } = {
  /** Opens the database and a write transaction on it, without writing anything: private modes refuse here. */
  check: () => run('readwrite', (s) => s.count()).then(() => undefined),
  all: () => run('readonly', (s) => s.getAll() as IDBRequest<LibraryItem[]>),
  put: (item) => run('readwrite', (s) => s.put(item)).then(() => undefined),
  remove: (id) => run('readwrite', (s) => s.delete(id)).then(() => undefined),
};
