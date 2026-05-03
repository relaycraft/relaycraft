import "@testing-library/jest-dom";

// Vitest jsdom sometimes provides a stub localStorage without setItem/getItem.
// Several stores (themeStore, notificationStore via persist) access localStorage
// at module evaluation time, so we ensure the full Storage API is available.
if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== "function") {
  const storage: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        const keys = Object.keys(storage);
        for (const k of keys) {
          delete storage[k];
        }
      },
      get length() {
        return Object.keys(storage).length;
      },
      key: (index: number) => Object.keys(storage)[index] ?? null,
    },
    writable: true,
    configurable: true,
  });
}
