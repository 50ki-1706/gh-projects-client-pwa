export type User = { name: string; email: string; image: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The generic browser client returns an envelope, not the server ALS session.
// Its upstream type resolves to any, so validate before projecting public data.
export function projectSessionUser(result: unknown): User | null {
  if (!isRecord(result) || result.error !== null) {
    throw new Error("Invalid session response");
  }
  if (result.data === null) return null;
  if (!isRecord(result.data) || !isRecord(result.data.user)) {
    throw new Error("Invalid session response");
  }
  const user = result.data.user;
  if (
    typeof user.name !== "string" || typeof user.email !== "string" ||
    (user.image !== undefined && user.image !== null && typeof user.image !== "string")
  ) {
    throw new Error("Invalid session response");
  }
  return { name: user.name, email: user.email, image: user.image ?? null };
}
