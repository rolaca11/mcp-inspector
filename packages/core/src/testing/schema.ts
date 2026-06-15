/**
 * Zod schemas + types for the declarative test-suite file format. A "suite"
 * file (YAML or JSON) names a target server and a list of cases; each case is a
 * sequence of steps, where every step performs one MCP action and optionally
 * asserts on / captures from the result.
 *
 * See `packages/cli/README.md` (Testing section) for the authored format.
 */

import { z } from "zod";

/** List operations a `list:` step can perform. */
export const LIST_KINDS = ["tools", "resources", "templates", "prompts"] as const;
export type ListKind = (typeof LIST_KINDS)[number];

const completeArgsSchema = z.strictObject({
  refType: z.enum(["prompt", "resource"]),
  ref: z.string(),
  argument: z.string(),
  value: z.string().optional(),
  context: z.record(z.string(), z.string()).optional(),
});

export type CompleteArgs = z.infer<typeof completeArgsSchema>;

/**
 * A single step. Exactly one action key (`call`/`read`/`get`/`list`/`complete`)
 * must be present; `strictObject` rejects typo'd keys (e.g. `expects:`) so a
 * malformed step fails loudly instead of passing vacuously.
 */
export const stepSchema = z
  .strictObject({
    call: z.string().optional(),
    read: z.string().optional(),
    get: z.string().optional(),
    list: z.enum(LIST_KINDS).optional(),
    complete: completeArgsSchema.optional(),
    /** Arguments for `call` (tool args) or `get` (prompt args). */
    with: z.record(z.string(), z.unknown()).optional(),
    /** Path -> matcher (or literal, shorthand for `equals`). `isError` is reserved. */
    expect: z.record(z.string(), z.unknown()).optional(),
    /** Variable name -> result path, bound into scope for later steps. */
    capture: z.record(z.string(), z.string()).optional(),
  })
  .refine(
    (s) =>
      [s.call, s.read, s.get, s.list, s.complete].filter(
        (v) => v !== undefined,
      ).length === 1,
    {
      message:
        "a step must contain exactly one action: call, read, get, list, or complete",
    },
  );

export type Step = z.infer<typeof stepSchema>;

export const caseSchema = z.strictObject({
  name: z.string().min(1),
  /** Overrides the suite-level target for this case. */
  target: z.string().optional(),
  /** Variables visible to this case's steps (merged over suite vars). */
  vars: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(stepSchema).min(1),
});

export type Case = z.infer<typeof caseSchema>;

export const suiteSchema = z.strictObject({
  /** Default target for every case (named server, URL, or stdio command). */
  target: z.string().optional(),
  /** Variables visible to every case. */
  vars: z.record(z.string(), z.unknown()).optional(),
  cases: z.array(caseSchema).min(1),
});

export type Suite = z.infer<typeof suiteSchema>;

/** A parsed suite paired with the file it came from. */
export interface LoadedSuite {
  source: string;
  suite: Suite;
}

/**
 * Validate an already-parsed object (from YAML/JSON) into a `Suite`, throwing a
 * readable, path-annotated error listing every problem when it doesn't conform.
 */
export function parseSuite(raw: unknown, source: string): Suite {
  const result = suiteSchema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid test suite in ${source}:\n${issues}`);
}
