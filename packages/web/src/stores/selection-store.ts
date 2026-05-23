import { create } from "zustand";

interface SelectionState {
  cache: Record<string, string>;
  get(serverName: string, tab: string): string | undefined;
  set(serverName: string, tab: string, value: string): void;
}

function key(serverName: string, tab: string) {
  return `${serverName}::${tab}`;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  cache: {},

  get(serverName, tab) {
    return get().cache[key(serverName, tab)];
  },

  set(serverName, tab, value) {
    set((s) => ({
      cache: { ...s.cache, [key(serverName, tab)]: value },
    }));
  },
}));
