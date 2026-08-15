# memo.js

## 1. lazy(factory)

- ​Zweck: Verzögerte Ausführung (Lazy Evaluation) und Speicherung eines Werts.
​Funktionsweise: Eine aufwendige Initialisierung (factory) wird erst ausgeführt, wenn das zurückgelieferte resolve zum ersten Mal aufgerufen wird.
- ​Caching: Das Ergebnis wird in value gespeichert. Folgende Aufrufe liefern direkt das gespeicherte Ergebnis zurück, ohne factory erneut auszuführen.
​- Reset: Über resolve.clear() wird der Zustand zurückgesetzt, sodass beim nächsten Aufruf die Berechnung erneut stattfindet.

```javascript
// Example usage
const getConfig = lazy(() => {
  // Expensive calculation or file read
  return { apiUrl: "https://api.example.com" };
});

// Factory function is executed on first call
const config1 = getConfig(); 

// Returns cached result instantly
const config2 = getConfig(); 

// Resets state
getConfig.clear(); 
```

## 2. lru(max = 100)

​- Zweck: Ein Cache nach dem Least Recently Used (LRU)-Prinzip mit fester Obergrenze (max).
- ​Funktionsweise: Verwendet intern eine JavaScript Map, welche die Einfügereihenfolge der Elemente garantiert.
- ​get(key): Bei jedem Lesezugriff wird der Eintrag gelöscht und neu gesetzt. Dadurch wandert er ans Ende der Map (wird als zuletzt verwendet markiert).
- ​set(key, value): Wenn die maximale Kapazität (max) erreicht ist, wird der älteste Eintrag (das erste Element der Map via store.keys().next().value) automatisch verworfen.
- ​API: Bietet gewohnte Map-Schnittstellen (get, set, has, delete, clear, keys, size).

```javascript
// Example usage with a max capacity of 2 items
const cache = lru(2);

cache.set("a", 1);
cache.set("b", 2);

// Accessing "a" makes it the most recently used
cache.get("a"); 

// Cache limit reached: "b" is evicted because "a" was used more recently
cache.set("c", 3); 

console.log(cache.has("b")); // false
```

## 3. memoize(callback, options)

- ​Zweck: Zwischenspeichern von Funktionsergebnissen basierend auf den Aufrufargumenten.
- ​Funktionsweise: Speichert den Rückgabewert von callback. Wird die Funktion später erneut mit demselben Key aufgerufen, kommt das Ergebnis direkt aus dem Speicher.
​Key-Generierung: Standardmäßig dient das erste Argument als Key (args[0]). Ein eigener Key-Generator kann über { key: (...args) => ... } übergeben werden.
- ​LRU-Integration: Ist max > 0, verwendet memoize intern den beschränkten lru()-Speicher. Andernfalls eine unbegrenzte Map.
​- Promise-Sicher: Wenn der Rückgabewert ein Promise ist und fehlschlägt (reject), fängt .catch() den Fehler ab und löscht den Key sofort wieder aus dem Cache. So werden fehlgeschlagene Asynchron-Operationen nicht dauerhaft gecacht.
​- API: Exponiert den Cache über .cache und bietet eine .clear()-Methode zum Zurücksetzen.

```javascript
// Example usage
const fetchUser = memoize(
  async (userId) => {
    const res = await fetch(`/api/users/${userId}`);
    return res.json();
  },
  {
    key: (userId) => `user_${userId}`,
    max: 50 // Keep at most 50 users in LRU cache
  }
);

// Fetches from API
await fetchUser(42); 

// Returns cached Promise instantly
await fetchUser(42); 
```
