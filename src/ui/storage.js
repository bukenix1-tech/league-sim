// @ts-check
// ブラウザの中 (IndexedDB) にセーブを 1 つしまう。中身は書き出しと同じ JSON の文字列。

const DB_NAME = "league-sim";
const STORE = "saves";
const KEY = "current";

/** @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {"readonly" | "readwrite"} mode
 * @param {(store: IDBObjectStore) => IDBRequest} action
 */
async function run(mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** @param {string} text */
export const storeSave = (text) => run("readwrite", (s) => s.put(text, KEY));

/** @returns {Promise<string | undefined>} */
export const loadStoredSave = () => run("readonly", (s) => s.get(KEY));
