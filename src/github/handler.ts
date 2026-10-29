import {
  defineHandler,
  type CloudContext,
  type HandlerInput,
  type TypedHandler,
  type ValidatorSlots,
} from "void";
import { getUser } from "void/auth";
import type { GenericSchema, InferOutput } from "valibot";
import { GitHubApiError, toErrorResponse } from "./errors.ts";
import { getGitHubAccessToken } from "./token.ts";

export function defineGitHubHandler<
  V extends ValidatorSlots,
  S extends GenericSchema,
>(
  { validators }: { validators: V; response: { schema: S } },
  operation: (token: string, input: HandlerInput<V>) => Promise<InferOutput<S>>,
): TypedHandler<V, InferOutput<S>> {
  const handler = async (c: CloudContext) => {
    try {
      const user = getUser();
      if (user === null) {
        throw new GitHubApiError("unauthenticated");
      }

      const validatedHandler = defineHandler.withValidator(validators)(async (
        _c,
        input,
      ) => {
        const token = await getGitHubAccessToken(user.id);
        return operation(token, input);
      });
      const response = await validatedHandler(c);
      if (response instanceof Response) {
        if (response.status === 400) {
          throw new GitHubApiError("invalid_request");
        }
        response.headers.set("Cache-Control", "no-store");
      }
      return response;
    } catch (error) {
      return toErrorResponse(error);
    }
  };

  // Preserve Void's phantom validator and success types across the auth wrapper.
  return handler as TypedHandler<V, InferOutput<S>>;
}
