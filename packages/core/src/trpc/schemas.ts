import { z } from "zod";

export const serverNameInput = z.object({ serverName: z.string().min(1) });

export const readResourceInput = serverNameInput.extend({
  items: z.union([
    z.object({ uri: z.string() }),
    z.array(z.object({ uri: z.string() })),
  ]),
});

export const callToolInput = serverNameInput.extend({
  items: z.union([
    z.object({
      name: z.string(),
      arguments: z.record(z.string(), z.unknown()).optional(),
    }),
    z.array(
      z.object({
        name: z.string(),
        arguments: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  ]),
});

export const getPromptInput = serverNameInput.extend({
  items: z.union([
    z.object({
      name: z.string(),
      arguments: z.record(z.string(), z.string()).optional(),
    }),
    z.array(
      z.object({
        name: z.string(),
        arguments: z.record(z.string(), z.string()).optional(),
      }),
    ),
  ]),
});

export const completeInput = serverNameInput.extend({
  items: z.union([
    z.object({
      refType: z.enum(["prompt", "resource"]),
      ref: z.string(),
      argument: z.string(),
      value: z.string().optional(),
      context: z.record(z.string(), z.string()).optional(),
    }),
    z.array(
      z.object({
        refType: z.enum(["prompt", "resource"]),
        ref: z.string(),
        argument: z.string(),
        value: z.string().optional(),
        context: z.record(z.string(), z.string()).optional(),
      }),
    ),
  ]),
});

export const configAddInput = z.object({
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).refine(
    (c) => "command" in c || "url" in c,
    { message: "config must have `command` or `url`" },
  ),
  force: z.boolean().optional(),
});

export const configRemoveInput = z.object({ name: z.string().min(1) });

export const savedFormScope = z.enum(["global", "tool"]);

export const savedFormListInput = z.object({
  serverName: z.string().optional(),
  toolName: z.string().optional(),
});

export const savedFormSaveInput = z
  .object({
    name: z.string().min(1),
    scope: savedFormScope,
    serverName: z.string().optional(),
    toolName: z.string().optional(),
    values: z.record(z.string(), z.string()),
  })
  .refine(
    (f) => f.scope === "global" || (!!f.serverName && !!f.toolName),
    { message: "`serverName` and `toolName` are required for tool scope" },
  );

export const savedFormRemoveInput = z.object({ id: z.string().min(1) });
