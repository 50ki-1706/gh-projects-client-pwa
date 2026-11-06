# gh-projects-client-pwa

GitHub Projects をライフログや、タスク管理用にスマートフォンで操作しやすくする専用クライアントです。

## features

- GitHub アカウントでのログイン
- 個人所有のプロジェクト一覧の取得
- プロジェクト内のアイテム一覧・詳細の取得

## API ドキュメント

アプリ起動後、次の URL で参照できます。

- `/docs`: API ドキュメント。
- `/docs/openapi`: OpenAPI 形式の API 仕様。

## 開発・検証

UI は React 19 / Material の CSR 専用です。Void の同一オリジン API / 認証 worker は維持します。

```sh
devenv shell -- pnpm install --frozen-lockfile
devenv shell -- pnpm dev
devenv shell -- pnpm typecheck
devenv shell -- pnpm typecheck:tsc
devenv shell -- pnpm test
devenv shell -- pnpm build
```
