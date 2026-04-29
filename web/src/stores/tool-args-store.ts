/**
 * Zustand store that persists tool argument values across navigation.
 *
 * Keyed by `serverName::toolName` so each tool on each server keeps its own
 * set of form values. When the user fills in arguments, navigates away, and
 * comes back, the values are still there.
 */

import { create } from "zustand";

type ArgsMap = Record<string, string>;

interface ToolArgsState {
  /** `{ "server::tool": { argName: "value", ... } }` */
  cache: Record<string, ArgsMap>;

  /** Get cached args for a tool (returns undefined if nothing was cached). */
  getArgs(serverName: string, toolName: string): ArgsMap | undefined;

  /** Replace the full arg map for a tool. */
  setArgs(serverName: string, toolName: string, values: ArgsMap): void;

  /** Update a single argument value for a tool. */
  setArg(serverName: string, toolName: string, argName: string, value: string): void;
}

function key(serverName: string, toolName: string) {
  return `${serverName}::${toolName}`;
}

export const useToolArgsStore = create<ToolArgsState>((set, get) => ({
  cache: {},

  getArgs(serverName, toolName) {
    return get().cache[key(serverName, toolName)];
  },

  setArgs(serverName, toolName, values) {
    set((s) => ({
      cache: { ...s.cache, [key(serverName, toolName)]: values },
    }));
  },

  setArg(serverName, toolName, argName, value) {
    const k = key(serverName, toolName);
    set((s) => ({
      cache: {
        ...s.cache,
        [k]: { ...s.cache[k], [argName]: value },
      },
    }));
  },
}));
