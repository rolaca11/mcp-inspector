import { create } from "zustand";

interface ResultState {
  cache: Record<string, unknown>;
  get<T>(serverName: string, category: string, itemKey: string): T | undefined;
  set(serverName: string, category: string, itemKey: string, value: unknown): void;
}

function key(serverName: string, category: string, itemKey: string) {
  return `${serverName}::${category}::${itemKey}`;
}

export const useResultStore = create<ResultState>((set, get) => ({
  cache: {},

  get<T>(serverName: string, category: string, itemKey: string): T | undefined {
    return get().cache[key(serverName, category, itemKey)] as T | undefined;
  },

  set(serverName, category, itemKey, value) {
    set((s) => ({
      cache: { ...s.cache, [key(serverName, category, itemKey)]: value },
    }));
  },
}));
