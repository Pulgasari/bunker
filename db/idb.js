// @bunker/db/idb.js
// indexeddb speaks in events, these turn the two shapes it has into promises

// a request: its result, or its error
export const requestOf = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror   = () => reject(request.error);
});

// a transaction: settles once it is over, rejects when it aborts or fails
export const transactionOf = (tx, label = 'transaction') => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort    = () => reject(tx.error ?? new DOMException(`[bunker] "${label}" transaction aborted`, 'AbortError'));
  tx.onerror    = () => reject(tx.error);
});
