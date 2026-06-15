import { create } from "zustand";

/**
 * Small persisted UI preference: whether the app sidebar is collapsed to an
 * icon rail.
 */
const SIDEBAR_KEY = "mcpi:sidebar-collapsed";

function readBool(key: string, fallback = false): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* non-fatal */
  }
}

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar(): void;
  setSidebarCollapsed(value: boolean): void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: readBool(SIDEBAR_KEY),

  toggleSidebar() {
    const next = !get().sidebarCollapsed;
    writeBool(SIDEBAR_KEY, next);
    set({ sidebarCollapsed: next });
  },

  setSidebarCollapsed(value) {
    writeBool(SIDEBAR_KEY, value);
    set({ sidebarCollapsed: value });
  },
}));
