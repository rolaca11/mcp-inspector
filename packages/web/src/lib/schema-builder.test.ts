import { describe, expect, it } from "vitest";

import type { MCPToolSchema, MCPToolSchemaProperty } from "../data/types";
import {
  mcpSchemaToZod,
  partialCoerce,
  resolveSchemaRefs,
} from "./schema-builder";

const recursiveSchema: MCPToolSchema = {
  type: "object",
  properties: {
    condition: {
      "$ref": "#/$defs/logic_node",
    },
  },
  "$defs": {
    logic_node: {
      oneOf: [
        {
          type: "object",
          properties: {
            operator: {
              type: "string",
              enum: ["AND", "OR"],
            },
            conditions: {
              type: "array",
              items: {
                "$ref": "#/$defs/logic_node",
              },
            },
          },
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: {
              const: "IS_COUNTRY",
            },
            countryCode: {
              type: "string",
              pattern: "^[a-zA-Z]{2}$",
            },
          },
          required: ["type", "countryCode"],
          additionalProperties: false,
        },
      ],
    },
  },
};

describe("schema-builder", () => {
  it("bounds recursive refs under oneOf branches", () => {
    const resolved = resolveSchemaRefs(recursiveSchema);
    const condition = resolved.properties?.condition;

    expect(Array.isArray(condition?.oneOf)).toBe(true);

    const branches = condition?.oneOf as MCPToolSchemaProperty[];
    const operatorBranch = branches[0];
    const recursiveItems = operatorBranch?.properties?.conditions?.items;

    expect(recursiveItems).toEqual({ "$ref": "#/$defs/logic_node" });
  });

  it("coerces oneOf object values as JSON objects", () => {
    const resolved = resolveSchemaRefs(recursiveSchema);
    const properties = resolved.properties ?? {};
    const value = { type: "IS_COUNTRY", countryCode: "HU" };
    const raw = { condition: JSON.stringify(value) };

    expect(partialCoerce(raw, properties)).toEqual({ condition: value });
    expect(mcpSchemaToZod(resolved).parse(raw)).toEqual({ condition: value });
  });

  it("rejects invalid JSON for oneOf object fields", () => {
    const resolved = resolveSchemaRefs(recursiveSchema);

    expect(
      mcpSchemaToZod(resolved).safeParse({ condition: "{not json" }).success,
    ).toBe(false);
  });
});
