import { create } from "zustand";

import type { MCPToolSchema } from "@/data/types";

interface ToolSchemaState {
  overrides: Record<string, MCPToolSchema>;
  getSchema(serverName: string, toolName: string): MCPToolSchema | undefined;
  setSchema(serverName: string, toolName: string, schema: MCPToolSchema | undefined): void;
}

function key(serverName: string, toolName: string) {
  return JSON.stringify([serverName, toolName]);
}

export const useToolSchemaStore = create<ToolSchemaState>((set, get) => ({
  overrides: {},

  getSchema(serverName, toolName) {
    return get().overrides[key(serverName, toolName)];
  },

  setSchema(serverName, toolName, schema) {
    set((state) => {
      const overrides = { ...state.overrides };
      const schemaKey = key(serverName, toolName);
      if (schema) overrides[schemaKey] = schema;
      else delete overrides[schemaKey];
      return { overrides };
    });
  },
}));
