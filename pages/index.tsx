import { Show, createSignal } from "solid-js";
import { useRouter } from "@void/solid";
import { auth } from "void/client";
import type { Props } from "./index.server";

export default function HomePage(props: Props) {
  const router = useRouter();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");

  async function signIn() {
    setPending(true);
    setError("");

    try {
      const result = await auth.signIn.social({
        provider: "github",
        callbackURL: "/",
      });
      if (result.error) setError("ログインに失敗しました。もう一度お試しください。");
    } catch {
      setError("ログインに失敗しました。もう一度お試しください。");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    setError("");

    try {
      const result = await auth.signOut();
      if (result.error) {
        setError("ログアウトに失敗しました。もう一度お試しください。");
        return;
      }
      await router.refresh();
    } catch {
      setError("ログアウトに失敗しました。もう一度お試しください。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="page-title">
        <h1 id="page-title">GitHub ログイン</h1>
        <Show
          when={props.user}
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
        <Show when={error()}>
          {(message) => <p class="error" role="alert">{message()}</p>}
        </Show>
      </section>
    </main>
  );
}
