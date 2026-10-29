import { useEffect, useRef, useState } from "react";
import { auth } from "void/client";
import { projectSessionUser, type User } from "./session";

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Each effect setup owns its requests, including StrictMode's replayed setup.
  const lifecycle = useRef<{ active: boolean; busy: boolean } | null>(null);

  useEffect(() => {
    const owner = { active: true, busy: false };
    lifecycle.current = owner;
    void loadSession();
    return () => {
      owner.active = false;
    };
  }, []);

  async function loadSession() {
    const owner = lifecycle.current;
    if (!owner?.active || owner.busy) return;
    owner.busy = true;
    setSession("loading");
    try {
      const nextUser = projectSessionUser(await auth.getSession());
      if (!owner.active) return;
      setUser(nextUser);
      setSession("ready");
    } catch {
      if (owner.active) setSession("error");
    } finally {
      if (owner.active) owner.busy = false;
    }
  }

  async function runAuthAction(
    action: () => Promise<{ error?: unknown }>,
    failureMessage: string,
    onSuccess?: () => void,
  ) {
    const owner = lifecycle.current;
    if (!owner?.active || owner.busy || session !== "ready") return;
    owner.busy = true;
    setPending(true);
    setError("");
    try {
      const result = await action();
      if (!owner.active) return;
      if (result.error) setError(failureMessage);
      else onSuccess?.();
    } catch {
      if (owner.active) setError(failureMessage);
    } finally {
      if (owner.active) {
        owner.busy = false;
        setPending(false);
      }
    }
  }

  function signIn() {
    return runAuthAction(
      () => auth.signIn.social({ provider: "github", callbackURL: "/" }),
      "ログインに失敗しました。もう一度お試しください。",
    );
  }

  function signOut() {
    return runAuthAction(
      () => auth.signOut(),
      "ログアウトに失敗しました。もう一度お試しください。",
      () => setUser(null),
    );
  }

  return { user, session, pending, error, retry: loadSession, signIn, signOut };
}
