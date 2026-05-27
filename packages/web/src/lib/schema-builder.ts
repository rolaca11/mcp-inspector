import { z } from "zod";
import type { MCPToolSchema, MCPToolSchemaProperty } from "@/data/types";

const COMBINATOR_KEYS = ["oneOf", "anyOf", "allOf"] as const;

function resolveJsonPointer(root: Record<string, unknown>, pointer: string): unknown {
  const path = pointer.replace(/^#\//, "").split("/").map(s =>
    s.replace(/~1/g, "/").replace(/~0/g, "~"),
  );
  let current: unknown = root;
  for (const segment of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveRefNode(
  node: Record<string, unknown>,
  root: Record<string, unknown>,
  seen: Set<string>,
): Record<string, unknown> {
  const ref = node["$ref"];
  if (typeof ref !== "string") return node;
  if (seen.has(ref)) return node;
  seen.add(ref);

  const resolved = resolveJsonPointer(root, ref);
  if (resolved == null || typeof resolved !== "object" || Array.isArray(resolved)) return node;

  const { "$ref": _, ...siblings } = node;
  const merged = { ...(resolved as Record<string, unknown>), ...siblings };
  return resolveRefsDeep(merged, root, seen);
}

function resolveRefsDeep(
  node: Record<string, unknown>,
  root: Record<string, unknown>,
  seen: Set<string>,
): Record<string, unknown> {
  let result = node;
  if ("$ref" in result) {
    result = resolveRefNode(result, root, seen);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [pName, pValue] of Object.entries(value as Record<string, unknown>)) {
        if (pValue && typeof pValue === "object" && !Array.isArray(pValue)) {
          props[pName] = resolveRefsDeep(pValue as Record<string, unknown>, root, new Set(seen));
        } else {
          props[pName] = pValue;
        }
      }
      out[key] = props;
    } else if (key === "items" && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = resolveRefsDeep(value as Record<string, unknown>, root, new Set(seen));
    } else if (
      (key === "anyOf" || key === "oneOf" || key === "allOf") &&
      Array.isArray(value)
    ) {
      out[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? resolveRefsDeep(item as Record<string, unknown>, root, new Set(seen))
          : item,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function resolveSchemaRefs(schema: MCPToolSchema): MCPToolSchema {
  const resolved = resolveRefsDeep(
    schema as unknown as Record<string, unknown>,
    schema as unknown as Record<string, unknown>,
    new Set(),
  );
  return resolved as unknown as MCPToolSchema;
}

export function resolveSchemaPropertyRef(
  prop: MCPToolSchemaProperty,
  root: MCPToolSchema,
): MCPToolSchemaProperty {
  if (typeof prop["$ref"] !== "string") return prop;
  return resolveRefsDeep(
    prop as unknown as Record<string, unknown>,
    root as unknown as Record<string, unknown>,
    new Set(),
  ) as unknown as MCPToolSchemaProperty;
}

export function schemaAlternativeOptions(
  prop: MCPToolSchemaProperty,
): { kind: "oneOf" | "anyOf"; options: MCPToolSchemaProperty[] } | null {
  for (const key of ["oneOf", "anyOf"] as const) {
    const value = prop[key];
    if (!Array.isArray(value)) continue;
    const options = value.filter(
      (item): item is MCPToolSchemaProperty =>
        item != null && typeof item === "object" && !Array.isArray(item),
    );
    if (options.length > 0) return { kind: key, options };
  }
  return null;
}

function schemaCombinatorOptions(prop: MCPToolSchemaProperty): MCPToolSchemaProperty[] {
  for (const key of COMBINATOR_KEYS) {
    const value = prop[key];
    if (!Array.isArray(value)) continue;
    return value.filter(
      (item): item is MCPToolSchemaProperty =>
        item != null && typeof item === "object" && !Array.isArray(item),
    );
  }
  return [];
}

export function resolveSchemaType(prop: MCPToolSchemaProperty): string | undefined {
  if (Array.isArray(prop.type)) {
    return prop.type.find((t) => t !== "null") ?? prop.type[0];
  }
  if (prop.type) return prop.type;
  if (prop.properties) return "object";
  if (prop.items) return "array";
  if (prop.const !== undefined) return typeof prop.const;

  const alternatives = schemaCombinatorOptions(prop);
  if (alternatives.length > 0) {
    const types = alternatives
      .map(resolveSchemaType)
      .filter((type): type is string => Boolean(type));
    const unique = new Set(types);
    if (unique.size === 1) return types[0] ?? undefined;
    if (unique.has("object")) return "object";
    if (unique.has("array")) return "array";
  }

  return undefined;
}

function isNullable(prop: MCPToolSchemaProperty): boolean {
  return Array.isArray(prop.type) && prop.type.includes("null");
}

function parseJsonString(value: string, ctx: z.RefinementCtx): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({ code: "custom", message: "invalid JSON" });
    return z.NEVER;
  }
}

function mcpPropertyToZod(
  prop: MCPToolSchemaProperty,
  required: boolean,
): z.ZodType {
  const type = resolveSchemaType(prop);
  let schema: z.ZodType;

  if (prop.enum) {
    const opts = prop.enum.map(String);
    schema = z.enum(opts as [string, ...string[]]);
  } else {
    switch (type) {
      case "number":
      case "integer": {
        let num = z.coerce.number();
        if (type === "integer") num = num.int();
        if (prop.minimum != null) num = num.min(prop.minimum);
        if (prop.maximum != null) num = num.max(prop.maximum);
        schema = num;
        break;
      }
      case "boolean":
        schema = z
          .enum(["true", "false"])
          .transform((v) => v === "true");
        break;
      case "object":
        schema = z
          .string()
          .transform((v, ctx) => {
            return parseJsonString(v, ctx);
          })
          .pipe(z.record(z.string(), z.unknown()));
        break;
      case "array":
        schema = z
          .string()
          .transform((v, ctx) => {
            return parseJsonString(v, ctx);
          })
          .pipe(z.array(z.unknown()));
        break;
      default:
        schema = z.string();
    }
  }

  if (isNullable(prop)) {
    schema = schema.nullable();

    if (required) {
      schema = z.union([
        z
          .literal("")
          .transform(() => null),
        schema,
      ]);
    }
  }

  if (!required) {
    schema = z.union([
      z
        .literal("")
        .transform(() => undefined),
      schema,
    ]);
  }

  return schema;
}

export function mcpSchemaToZod(schema: MCPToolSchema) {
  const properties = schema.properties ?? {};
  const requiredSet = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [name, prop] of Object.entries(properties)) {
    shape[name] = mcpPropertyToZod(prop, requiredSet.has(name));
  }

  return z.object(shape);
}

export function templateVariablesToZod(variables: string[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const v of variables) {
    shape[v] = z.string().min(1);
  }
  return z.object(shape);
}

export function reverseCoerceArguments(
  parsed: Record<string, unknown>,
  properties: Record<string, MCPToolSchemaProperty>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(properties)) {
    const value = parsed[name];
    if (value === undefined || value === null) {
      out[name] = "";
      continue;
    }
    if (typeof value === "object") {
      out[name] = JSON.stringify(value);
    } else {
      out[name] = String(value);
    }
  }
  return out;
}

export function partialCoerce(
  values: Record<string, string>,
  properties: Record<string, MCPToolSchemaProperty>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(values)) {
    const prop = properties[name];
    if (!prop) continue;
    const trimmed = (raw ?? "").trim();
    if (trimmed === "") {
      if (prop.enum && isNullable(prop)) {
        out[name] = null;
      }
      continue;
    }

    const type = resolveSchemaType(prop);
    switch (type) {
      case "number":
      case "integer": {
        const n = Number(trimmed);
        if (!Number.isNaN(n)) out[name] = n;
        break;
      }
      case "boolean":
        out[name] = trimmed === "true";
        break;
      case "object":
      case "array":
        try {
          out[name] = JSON.parse(trimmed);
        } catch {
          // skip invalid JSON
        }
        break;
      default:
        out[name] = trimmed;
    }
  }
  return out;
}
