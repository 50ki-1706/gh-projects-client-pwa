import { Show, createSignal, onSettled } from "solid-js";
import { auth } from "void/client";
import { projectSessionUser, type User } from "./session";

export default function App() {
  const [user, setUser] = createSignal<User | null>(null);
  const [session, setSession] = createSignal<"loading" | "ready" | "error">("loading");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  let disposed = false;
  let busy = false;
  let revision = 0;
  onSettled(() => {
    void loadSession();
    return () => { disposed = true; revision++; };
  });

  async function loadSession() {
    if (disposed || busy) return;
    busy = true;
    const request = ++revision;
    setSession("loading");
    try {
      const nextUser = projectSessionUser(await auth.getSession());
      if (disposed || request !== revision) return;
      setUser(nextUser);
      setSession("ready");
    } catch {
      if (!disposed && request === revision) setSession("error");
    } finally {
      busy = false;
    }
  }

  async function runAuthAction(
    action: () => Promise<{ error?: unknown }>,
    failureMessage: string,
    onSuccess?: () => void,
  ) {
    if (disposed || busy || session() !== "ready") return;
    busy = true;
    setPending(true);
    setError("");

    try {
      const result = await action();
      if (disposed) return;
      if (result.error) {
        setError(failureMessage);
        return;
      }
      onSuccess?.();
    } catch {
      if (!disposed) setError(failureMessage);
    } finally {
      busy = false;
      if (!disposed) setPending(false);
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

  return (
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="page-title">
        <h1 id="page-title">GitHub ログイン</h1>
        <Show when={session() === "loading"}>
          <p role="status">読み込み中…</p>
        </Show>
        <Show when={session() === "error"}>
          <p class="error" role="alert">セッションの取得に失敗しました。もう一度お試しください。</p>
          <button type="button" onClick={loadSession}>再試行</button>
        </Show>
        <Show when={session() === "ready"}>
          <Show
            when={user()}
            fallback={
              <button type="button" disabled={pending()} onClick={signIn}>
                {pending() ? "ログイン中…" : "GitHubでログイン"}
              </button>
            }
          >
            {(user) => (
              <div class="profile">
                <Show when={user().image}>
                  {(image) => (
                    <img
                      class="profile-image"
                      src={image()}
                      alt={`${user().name}のプロフィール画像`}
                    />
                  )}
                </Show>
                <p class="profile-name">{user().name}</p>
                <p class="profile-email">{user().email}</p>
                <button type="button" disabled={pending()} onClick={signOut}>
                  {pending() ? "ログアウト中…" : "ログアウト"}
                </button>
              </div>
            )}
          </Show>
        </Show>
        <Show when={error()}>
          {(message) => <p class="error" role="alert">{message()}</p>}
        </Show>
      </section>
    </main>
  );
}
