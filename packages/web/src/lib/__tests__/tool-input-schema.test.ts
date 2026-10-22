import { afterEach, describe, expect, it } from "vitest";

import type { MCPToolSchema } from "@/data/types";
import { mcpSchemaToZod, resolveSchemaRefs } from "@/lib/schema-builder";
import { parseToolInputSchema, toolSchemaFormValues } from "@/lib/tool-input-schema";
import { useToolSchemaStore } from "@/stores/tool-schema-store";

afterEach(() => {
  useToolSchemaStore.setState({ overrides: {} });
});

describe("tool input schema overrides", () => {
  const serverSchema: MCPToolSchema = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  };

  it("preserves references and metadata when parsing an edited schema", () => {
    const schema = {
      type: "object",
      properties: { limit: { $ref: "#/$defs/limit" } },
      $defs: { limit: { type: "integer", minimum: 1, default: 5 } },
      additionalProperties: false,
      "x-custom": { enabled: true },
    };

    expect(parseToolInputSchema(JSON.stringify(schema))).toEqual(schema);
    expect(toolSchemaFormValues(parseToolInputSchema(JSON.stringify(schema)))).toEqual({ limit: "5" });
  });

  it.each([
    "{",
    "null",
    "[]",
    '"schema"',
    '{}',
    '{"type":"array"}',
    '{"type":"object","properties":[]}',
    '{"type":"object","required":"query"}',
    '{"type":"object","properties":{"query":null}}',
    '{"type":"object","properties":{"query":{"enum":"a"}}}',
    '{"type":"object","properties":{"limit":{"minimum":"1"}}}',
    '{"type":"object","$defs":{"broken":{"required":true}}}',
  ])("rejects invalid input without changing the active override: %s", (text) => {
    useToolSchemaStore.getState().setSchema("server", "search", serverSchema);

    expect(() => parseToolInputSchema(text)).toThrow();
    expect(useToolSchemaStore.getState().getSchema("server", "search")).toEqual(serverSchema);
  });

  it("uses edited properties and types to build and validate tool arguments", () => {
    const override = parseToolInputSchema(JSON.stringify({
      type: "object",
      properties: {
        query: { type: "integer", minimum: 1 },
        options: { type: "object", default: { verbose: true } },
        enabled: { type: "boolean", default: false },
      },
      required: ["query"],
    }));
    const values = toolSchemaFormValues(override, { query: "12", removed: "stale" });
    const validator = mcpSchemaToZod(resolveSchemaRefs(override));

    expect(values).toEqual({ query: "12", options: '{"verbose":true}', enabled: "false" });
    expect(validator.parse(values)).toEqual({ query: 12, options: { verbose: true }, enabled: false });
    expect(validator.safeParse({ ...values, query: "text" }).success).toBe(false);
    expect(validator.safeParse({ ...values, query: "" }).success).toBe(false);
    expect(serverSchema.properties?.query?.type).toBe("string");
  });

  it("keeps overrides per server and tool and restores the latest server schema on reset", () => {
    const store = useToolSchemaStore.getState();
    const override: MCPToolSchema = { type: "object", properties: { limit: { type: "number" } } };
    store.setSchema("server-a", "search", override);
    store.setSchema("server-a", "other", serverSchema);
    store.setSchema("server-b", "search", serverSchema);

    expect(store.getSchema("server-a", "search")).toEqual(override);
    expect(store.getSchema("server-a", "other")).toEqual(serverSchema);
    expect(store.getSchema("server-b", "search")).toEqual(serverSchema);

    store.setSchema("server-a", "search", undefined);

    expect(store.getSchema("server-a", "search") ?? serverSchema).toEqual(serverSchema);
    expect(store.getSchema("server-a", "other")).toEqual(serverSchema);
    expect(store.getSchema("server-b", "search")).toEqual(serverSchema);
  });
});
