import { TRPCError } from "@trpc/server";

import {
  validateElicitationFormContent,
  type ElicitationResult,
} from "../../elicitation.js";
import { pendingElicitationsInput, respondElicitationInput } from "../schemas.js";
import { publicProcedure, router, type TRPCContext } from "../trpc.js";

function requireBroker(ctx: TRPCContext) {
  if (!ctx.elicitations) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Elicitation is not enabled on this server",
    });
  }
  return ctx.elicitations;
}

export const elicitationsRouter = router({
  pending: publicProcedure.input(pendingElicitationsInput).query(({ ctx, input }) =>
    requireBroker(ctx).list(input?.serverName),
  ),

  respond: publicProcedure.input(respondElicitationInput).mutation(({ ctx, input }) => {
    const broker = requireBroker(ctx);
    const pending = broker.get(input.id);
    if (!pending) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No pending elicitation with id ${input.id}; it may have expired or been cancelled`,
      });
    }

    let result: ElicitationResult = { action: input.action };
    if (input.action === "accept" && pending.params.mode === "form") {
      const validation = validateElicitationFormContent(
        pending.params.requestedSchema,
        input.content,
      );
      if (!validation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: Object.entries(validation.errors)
            .map(([field, error]) => `${field}: ${error}`)
            .join("; "),
          cause: validation.errors,
        });
      }
      result = { action: "accept", content: validation.content };
    }

    return broker.respond(input.id, result);
  }),
});
