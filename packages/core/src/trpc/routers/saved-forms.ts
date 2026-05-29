import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { TRPCError } from "@trpc/server";

import { savedFormsPath } from "../../paths.js";
import {
  savedFormListInput,
  savedFormRemoveInput,
  savedFormSaveInput,
} from "../schemas.js";
import { publicProcedure, router } from "../trpc.js";

/**
 * A persisted tool-call input form. `values` is the raw string map the GUI's
 * form fields round-trip through (the same shape `tool-args-store` caches), so
 * loading a saved form restores the fields verbatim.
 *
 * `global` forms apply to every tool; `tool` forms are pinned to a specific
 * `serverName`/`toolName` pair.
 */
interface SavedForm {
  id: string;
  name: string;
  scope: "global" | "tool";
  serverName?: string;
  toolName?: string;
  values: Record<string, string>;
}

function readForms(): SavedForm[] {
  const p = savedFormsPath();
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { forms?: unknown }).forms)
  ) {
    return [];
  }
  return (parsed as { forms: SavedForm[] }).forms;
}

function writeForms(forms: SavedForm[]): void {
  const p = savedFormsPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ forms }, null, 2) + "\n");
}

export const savedFormsRouter = router({
  /**
   * List the forms relevant to a tool: those scoped to this exact
   * server/tool, plus all global ones. The client renders `scoped` first.
   */
  list: publicProcedure.input(savedFormListInput).query(({ input }) => {
    const forms = readForms();
    const scoped = forms.filter(
      (f) =>
        f.scope === "tool" &&
        f.serverName === input.serverName &&
        f.toolName === input.toolName,
    );
    const global = forms.filter((f) => f.scope === "global");
    return { scoped, global };
  }),

  save: publicProcedure.input(savedFormSaveInput).mutation(({ input }) => {
    const forms = readForms();

    // Overwrite an existing form with the same name within the same scope so
    // re-saving under a known name updates it instead of duplicating.
    const matchIdx = forms.findIndex(
      (f) =>
        f.name === input.name &&
        f.scope === input.scope &&
        (input.scope === "global" ||
          (f.serverName === input.serverName &&
            f.toolName === input.toolName)),
    );

    const entry: SavedForm = {
      id: matchIdx >= 0 ? forms[matchIdx]!.id : randomUUID(),
      name: input.name,
      scope: input.scope,
      ...(input.scope === "tool"
        ? { serverName: input.serverName, toolName: input.toolName }
        : {}),
      values: input.values,
    };

    if (matchIdx >= 0) forms[matchIdx] = entry;
    else forms.push(entry);
    writeForms(forms);
    return entry;
  }),

  remove: publicProcedure.input(savedFormRemoveInput).mutation(({ input }) => {
    const forms = readForms();
    const next = forms.filter((f) => f.id !== input.id);
    if (next.length === forms.length) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `saved form "${input.id}" not found`,
      });
    }
    writeForms(next);
    return { ok: true as const, id: input.id };
  }),
});
