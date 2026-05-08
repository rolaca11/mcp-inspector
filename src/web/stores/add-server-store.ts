import { create } from "zustand";

export interface AddServerFormValues {
  name: string;
  mode: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  cwd: string;
  url: string;
  httpType: string;
  headers: string;
}

export const ADD_SERVER_DEFAULTS: AddServerFormValues = {
  name: "",
  mode: "stdio",
  command: "",
  args: "",
  env: "",
  cwd: "",
  url: "",
  httpType: "http",
  headers: "",
};

interface AddServerState {
  values: AddServerFormValues;
  set(patch: Partial<AddServerFormValues>): void;
  setAll(values: AddServerFormValues): void;
  reset(): void;
}

export const useAddServerStore = create<AddServerState>((set) => ({
  values: ADD_SERVER_DEFAULTS,

  set(patch) {
    set((s) => ({ values: { ...s.values, ...patch } }));
  },

  setAll(values) {
    set({ values });
  },

  reset() {
    set({ values: ADD_SERVER_DEFAULTS });
  },
}));
