# アーキテクチャ

## Summary

UI は React 19 と Material を使う CSR 専用です。Void の同一オリジン worker が
認証、GitHub Projects API、API ドキュメントを処理します。UI の SSR / hydration は使いません。

## Details

`index.html` の空の `#app` に `src/client/main.tsx` が React の `createRoot` で
描画します。Vite は `voidPlugin()` と React plugin を使い、JSX は `react-jsx` で
変換します。UI は `material/react` と同梱の Material Symbols SVG を使い、外部
フォントを読み込みません。`pages/`、Pages loader、serverFunctions は使いません。

UI は `void/client` の generic Better Auth client から同一オリジンの `/api/auth/*` に
アクセスします。`getSession()` の `{ data, error }` envelope を `session.ts` が
実行時検証し、name / email / image だけを UI に投影します。匿名は
`{ data: null, error: null }` のみです。不正な envelope / user / image または
非 null の error は取得失敗とし、余分な private field は投影しません。

`useAuthSession` は読み込み中・未ログイン・ログイン済み・取得失敗を区別し、
失敗時の再試行を提供します。effect ごとにリクエストの所有者を設け、破棄後や
StrictMode の再実行で古くなった結果を反映しません。認証操作中は重複操作を防ぎ、
ログアウト成功時のみローカルの user を消します。トークン保存や `/api/me` は追加しません。

GitHub トークンの取得・保存・送信はサーバーのみが担当します。ブラウザー検証では
navigation 前に認証リクエストをモックし、実 OAuth / 認証 DB は使用しません。

`inference.appType: 'void'` で API worker を維持します。`routing.notFound` は
上書きしません。`/docs` の document routes により Void が worker-first と
worker-owned navigation fallback を推論します。実 asset / server route の処理後、
404 かつ `Accept: text/html` の navigation は `/index.html` にフォールバックします。
存在しない script / style / image は 404 です。document routes を削除する場合は
この推論の再検証が必要です。`dist/ssr` はバックエンド worker であり、UI SSR ではありません。

依存バージョンは [package.json](package.json) と [pnpm-lock.yaml](pnpm-lock.yaml) を
参照してください。通常の検証は README の両 typecheck / test / build を実行します。
ブラウザー検証の手順と dev / built worker の制約は
[tests/browser/README.md](tests/browser/README.md) を参照してください。
