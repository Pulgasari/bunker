// @bunker/utils/channel.js

// cross-tab notification. BroadcastChannel where it exists (window, worker and
// service worker alike), otherwise the localStorage `storage` event, which fires
// in every *other* tab of the origin. neither delivers to the sender, so both
// behave the same way from the caller's side.

const FALLBACK_PREFIX     = '__bunker_sync__' + ':';
const hasBroadcastChannel = () => typeof globalThis.BroadcastChannel === 'function';

const localStore = () => {
  try   { return globalThis.localStorage ?? null; }
  catch { return null; } // throws outright under a strict cookie policy
};

export function createChannel (name) {
  const listeners = new Set;
  const emit      = message  => { for (const listener of listeners) listener(message); };
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

  if (hasBroadcastChannel()) {
    const channel = new BroadcastChannel(name);
    channel.onmessage = event => emit(event.data);

    return {
      transport : 'broadcast-channel',
      close     : () => { listeners.clear(); channel.close(); },
      post      : message => channel.postMessage(message),
      subscribe,
    };
  }

  const store = localStore();
  if (!store) return { transport: 'none', close: () => listeners.clear(), post: () => {}, subscribe };

  const key     = FALLBACK_PREFIX + name;
  const onEvent = (event) => {
    if (event.key !== key || event.newValue == null) return;
    try   { emit(JSON.parse(event.newValue).message); }
    catch { /* a foreign writer on the same key, nothing to deliver */ }
  };

  globalThis.addEventListener?.('storage', onEvent);

  return {
    transport : 'storage-event',
    close     : () => { listeners.clear(); globalThis.removeEventListener?.('storage', onEvent); },
    subscribe,

    // the value has to change for the event to fire, hence the nonce. the entry is
    // removed right after: it is a signal, not state, and must not occupy quota.
    post (message) {
      try {
        store.setItem(key, JSON.stringify({ message, nonce: Math.random() }));
        store.removeItem(key);
      } catch { /* full or blocked storage just means no cross-tab sync */ }
    },
  };
}

export default createChannel;
