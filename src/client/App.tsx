import { Button, Card, LoadingIndicator } from "material/react";
import { icons } from "./icons";
import { useAuthSession } from "./useAuthSession";

export default function App() {
  const { user, session, pending, error, retry, signIn, signOut } =
    useAuthSession();

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="page-title">
        <Card
          variant="outlined"
          className="auth-card"
          aria-label="GitHub ログイン"
        >
          <div className="auth-content">
            <h1 id="page-title">GitHub ログイン</h1>
            {session === "loading" && (
              <div className="session-status" role="status">
                <LoadingIndicator aria-hidden="true" />
                <p>読み込み中…</p>
              </div>
            )}
            {session === "error" && (
              <>
                <p className="error" role="alert">
                  セッションの取得に失敗しました。もう一度お試しください。
                </p>
                <Button icon={icons.refresh} onClick={retry}>
                  再試行
                </Button>
              </>
            )}
            {session === "ready" &&
              (user ? (
                <div className="profile">
                  {user.image && (
                    <img
                      className="profile-image"
                      src={user.image}
                      alt={`${user.name}のプロフィール画像`}
                    />
                  )}
                  <p className="profile-name">{user.name}</p>
                  <p className="profile-email">{user.email}</p>
                  <Button
                    icon={icons.logout}
                    disabled={pending}
                    onClick={signOut}
                  >
                    {pending ? "ログアウト中…" : "ログアウト"}
                  </Button>
                </div>
              ) : (
                <Button icon={icons.login} disabled={pending} onClick={signIn}>
                  {pending ? "ログイン中…" : "GitHubでログイン"}
                </Button>
              ))}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}
