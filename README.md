# aws-mastra-agent-example

## ローカルでの実行

### MCP サーバー(Streamable HTTP) の起動

```shell
cd platform
pnpm dlx tsx lambda/mcp-server/index.ts
```

### Agent (MCP Host) の起動

別のターミナルセッションで `pnpm dev` を実行する。

※ AWS の一時的なクレデンシャル設定を行なっておくこと
※2 必要でれば Langfuse のクレデンシャルも設定しておくこと。

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASEURL`

```shell
cd platform
pnpm dev
```
