# モック CSR ブラウザー検証

追加の npm 依存は不要です。Chrome と PATH 上の `playwright-cli` を用意します。
CLI の場所は `PLAYWRIGHT_CLI` で上書きできます。

## dev

DB 操作を行わず foreground で dev / lifecycle の両 suite を実行する場合:

```sh
devenv shell -- node tests/browser/dev.mjs
```

この harness は実 Vite config を読み込み、`void:migrations` plugin だけを除外します。
plugin が正確に 1 個でなければ失敗し、他の plugin と認証/API 契約は維持します。
通常の `pnpm dev` は Void の local auth migration を自動実行するため、DB 操作を
許可しない検証にはこの harness を使ってください。起動した server は finally で閉じます。

既に利用を許可した dev server がある場合は以下の個別 runner も利用できます。
別のターミナルで `devenv shell -- pnpm dev --host localhost --port 5173 --strictPort` を
起動し、検証後は自分が起動した dev server を停止してください。

```sh
CSR_BASE_URL=http://localhost:5173 devenv shell -- node tests/browser/run.mjs
CSR_LIFECYCLE=1 CSR_BASE_URL=http://localhost:5173 devenv shell -- node tests/browser/run.mjs
```

`CSR_LIFECYCLE=1` は新規 browser context で dev-only の `lifecycle.html` を開き、
実 App の StrictMode replay / superseded response、session / action の処理中 unmount と
新 root の独立性を検証します。fixture は typecheck 対象ですが production には import
されません。built mode との同時指定は拒否します。

## built worker

```sh
devenv shell -- pnpm build
CSR_BUILT_WORKER=1 CSR_BASE_URL=http://localhost:5174 devenv shell -- node tests/browser/run.mjs
```

runner は同じ `csr.cjs` を実行します。Wrangler `unstable_dev` に built worker / 設定を
渡し、`vars.BETTER_AUTH_SECRET` は `randomBytes` でメモリ生成します。値は出力せず、
環境ファイルを作らず、永続化を無効にしたローカル runtime を終了時に停止します。
通常の `vite preview` の process env 注入には依存しません。

両モードとも runner が隔離した名前付き Chrome session を起動・終了します。
`CSR_BASE_URL` は localhost HTTP のみ許可し、省略時は dev:5173 / built:5174 です。
最初の navigation 前に全 `/api/auth/*` をモックします。
OAuth / 実セッション DB にはアクセスしません。`/api/projects` は cookie なしの
401 のみ検証します。`/docs` は HTTP で取得するだけで CDN の JS は実行しません。
document HTTP probes は明示的に `Accept: text/html` を送り、deep link は実 navigation
でも UI の描画を確認します。実 JS / CSS の MIME、存在しない JS / CSS / PNG の厳密な
404、実 module script の失敗も検証します。認証失敗用 400 と指定した欠損 asset の
404 だけを期待済み console resource error として分類し、module MIME error や
無関係なエラーは失敗させます。

さらに実 MD3 custom host と shadow 内 native button、disabled、日本語 accessible name、
decorative Material Symbols、Tab focus / Enter activation、nullable / valid avatar、
desktop / 320px の長文 profile の横 overflow を確認します。loading / anonymous /
profile / error / mobile の screenshot は隔離した一時 directory に保存し、結果にパスを
出力します。client graph に server / Solid / dev fixture が混入した場合も失敗します。

失敗時は非 0 exit、成功時はケース・認証リクエスト・クライアント script graph・
期待済み / 予期しないブラウザーエラー一覧を JSON で出力します。
