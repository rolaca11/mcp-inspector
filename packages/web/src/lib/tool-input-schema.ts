import { z } from "zod";

import type { MCPToolSchema } from "@/data/types";
import { mcpSchemaToZod, resolveSchemaRefs } from "@/lib/schema-builder";

const schemaType = z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]);

const propertySchema: z.ZodType<Record<string, unknown>> = z.lazy(() => z.looseObject({
  type: z.union([schemaType, z.array(schemaType).min(1)]).optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), propertySchema).optional(),
  required: z.array(z.string()).optional(),
  enum: z.array(z.unknown()).min(1).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  items: z.union([propertySchema, z.array(propertySchema), z.boolean()]).optional(),
  oneOf: z.array(propertySchema).min(1).optional(),
  anyOf: z.array(propertySchema).min(1).optional(),
  allOf: z.array(propertySchema).min(1).optional(),
  $ref: z.string().optional(),
  $defs: z.record(z.string(), propertySchema).optional(),
  definitions: z.record(z.string(), propertySchema).optional(),
}));

export function parseToolInputSchema(text: string): MCPToolSchema {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Enter valid JSON.");
  }

  const result = propertySchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.join(".");
    throw new Error(`${path ? `${path}: ` : ""}${issue.message}`);
  }
  if (result.data.type !== "object") {
    throw new Error('The input schema must have type "object".');
  }

  const schema = result.data as MCPToolSchema;
  mcpSchemaToZod(resolveSchemaRefs(schema));
  return schema;
}

export function toolSchemaFormValues(
  schema: MCPToolSchema,
  values: Record<string, string> = {},
): Record<string, string> {
  return Object.fromEntries(Object.entries(resolveSchemaRefs(schema).properties ?? {}).map(([name, prop]) => {
    const value = values[name] ?? (prop.default === undefined
      ? ""
      : typeof prop.default === "object" && prop.default !== null
        ? JSON.stringify(prop.default)
        : String(prop.default));
    return [name, value];
  }));
}
