# アーキテクチャ

## CSR UI

`index.html` が日本語のメタデータと空の `#app` を持ち、`src/client/main.tsx` が
`@solidjs/web` の `render` で `App.tsx` を描画します。CSS は従来のログイン画面のままです。
UI の SSR / hydration / Pages loader は使いません。`pages/` は空でも Pages モードを
有効化するため、ディレクトリ自体を置きません。`@void/solid` は不要です。

Vite は `voidPlugin()` と `solidPlugin({ ssr: false })` を使用します。
Solid Start と serverFunctions は設定せず、いずれも無効です。
`jsxImportSource` は `@solidjs/web` です。

## 認証とサーバーの境界

UI は `void/client` の generic Better Auth client を使い、同一オリジンの
`/api/auth/*` へアクセスします。Solid 1 用の Better Auth adapter は読み込みません。
初回の `auth.getSession()` はサーバーの ALS API とは異なる `{ data, error }` envelope
です。読み込み中・未ログイン・ログイン済み・取得失敗（再試行可能）を区別し、
`session.ts` は応答を `unknown` として実行時検証し、name / email / image のみを
UI に投影します。匿名は `{ data: null, error: null }` のみです。壊れた envelope / user /
image や非 null の error は取得失敗として扱い、余分な private field は投影しません。

ログインは `signIn.social({ provider: 'github', callbackURL: '/' })`、ログアウトは
`signOut()` を使います。`App.tsx` 内の `runAuthAction` が両操作の処理中状態、
エラーの初期化・表示、終了処理を共通管理します。セッション取得完了後のみ操作を受け付け、
処理中はボタンを無効化し、重複操作を防ぎます。
破棄後や古い取得結果は UI に反映しません。ログアウト成功時のみローカルの user を
消し、失敗時は保持します。トークン保存や `/api/me` は追加しません。

`auth.ts`、`routes/api/projects`、`routes/docs` と `src/github` はサーバー側のままです。
GitHub トークンの取得・保存・送信はサーバーのみが担当し、クライアントから import
しません。ブラウザー検証では認証リクエストを先にモックし、実 OAuth / 認証 DB は
使用しません。

## Void worker とフォールバック

`inference.appType: 'void'` を明示して API worker を維持します。
`routing.notFound` は上書きしません。保持している `/docs` の document routes により
Void が worker-first / assets `not_found_handling: 'none'` と worker-owned navigation
fallback を推論します。実 asset / server route の処理後、404 かつ `Accept: text/html`
の navigation は `/index.html` にフォールバックします。document routes を削除する場合は
この推論も再検証が必要です。

`spa` / `static` appType や static output ではありません。API と `/docs` は
サーバールートが処理し、script / style / image リクエストの不明な asset は 404 です。
明示的な `single-page-application` asset policy は script にも HTML / 200 を返すため
設定しません。middleware や framework patch は追加していません。
ビルドされる `dist/ssr` はバックエンド worker であり、UI SSR の導入を意味しません。

## バージョンと検証

- `solid-js` / `@solidjs/web`: **2.0.0-rc.18**（完全固定）
- `@solidjs/vite-plugin`: **3.0.0-next.51**（完全固定）
- `void`: **1.2.1**（完全固定）
- Vite: **8.3.4**（lockfile）、TypeScript: **7.1.0-beta**、
  tsrs: **0.18.0-ts7.1.0-dev.20260929**

通常の検証は README の frozen install / 両 typecheck / test / build を実行します。
`tests/csr.test.mjs` と `tests/csr.types.ts` が shell・設定・公開 profile の投影・
generic auth envelope の型を検証します。`tests/browser/csr.cjs` は playwright-cli で
実ブラウザーの状態遷移と同一オリジン HTTP 契約を検証する再現可能なモックです。
`tests/browser/run.mjs` から `CSR_BASE_URL` を指定し、同じテストを dev / built worker に
実行します。built worker は Wrangler の runtime binding にメモリ生成のテスト専用
Better Auth secret を渡します。秘密ファイルを作らず、実 OAuth は検証しません。

pnpm は Solid runtime を追加した完全固定の `pnpm add --save-exact` コマンドで
`@solidjs/signals@2.0.0-rc.18` / `@solidjs/web@2.0.0-rc.18` / `solid-js@2.0.0-rc.18` の
3 件だけを `minimumReleaseAgeExclude` に自動追加しました。例外を広げず、既存の
native build permissions を維持しています。
Better Auth の Solid 1 peer 宣言と Solid 2 の衝突は残り、`pnpm peers check` は失敗します。
peer 検証は抑制せず、実際の client graph が vanilla `better-auth/client` を読み、
Solid 1 adapter / store を含まないことを確認します。
