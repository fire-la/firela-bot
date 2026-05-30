# firela-bot 🤖

A minimalist, self-hosted AI financial advisor for FIRE planning.

## Overview

firela-bot is the **BOT** component of [FIREla](https://firela.io) — it reads your lifetime ledger data to build your financial profile and deliver personalized FIRE (Financial Independence, Retire Early) insights.

FIREla consists of two independent parts that work together:

| | BOT | APP |
|---|---|---|
| What | firela-bot | [firela-app](https://github.com/fire-la/firela-app) |
| | bot - AI advisor for FIRE planning | Beancount lifetime ledger |
| | BillClaw - Automated billing ingestion | Zero tracking · Full privacy |

### Key Features

- **AI Financial Advisor**: Personalized FIRE planning based on your actual spending and income
- **Automated Billing Ingestion**: Import transactions from Plaid, Gmail, and GoCardless
- **Self-Hosted & Private**: Deploy to Cloudflare Workers (free tier) — your data stays yours
- **Lifetime Ledger Integration**: Reads from your Beancount ledger for accurate financial analysis
- **Flexible Export**: Beancount, Ledger, or CSV output formats

## Deployment

Deploy to Cloudflare Workers with one click:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/fire-la/firela-bot/tree/main/packages/ui)

Free tier: 100K requests/day, 10ms CPU time — more than enough for personal use.

See the [Cloudflare Deployment Guide](./billclaw-docs/docs/guide/cloudflare-deployment.md) for detailed instructions.

## About BillClaw

BillClaw is the billing ingestion engine inside firela-bot. It uses a framework-agnostic core with runtime adapters:

```
┌──────────────────────────────────────────────┐
│              @firela/billclaw-ui              │
│         React SPA + Hono API Server          │
│         Cloudflare Workers                   │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────┴───────────────────────────┐
│           @firela/billclaw-cli               │
│           Standalone CLI                     │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────┴───────────────────────────┐
│          @firela/billclaw-core               │
│          (Framework-Agnostic)                │
│  ├─ sources/ (Plaid, Gmail, GoCardless)     │
│  ├─ exporters/ (Beancount, Ledger)          │
│  ├─ oauth/ · models/ · storage/             │
│  └─ parsers/ · webhook/ · security/         │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────┴───────────────────────────┐
│        @firela/runtime-adapters              │
│   Cloudflare Workers · Node.js               │
└──────────────────────────────────────────────┘
```

### [@firela/billclaw-core](./packages/billclaw/core)

Framework-agnostic core — all business logic with zero platform dependencies.

- Data models with Zod validation
- Sources: Plaid, Gmail, GoCardless
- Exporters: Beancount, Ledger
- OAuth, storage, parsers, webhook, security

### [@firela/billclaw-cli](./packages/billclaw/cli)

Standalone CLI for transaction sync, configuration, and export.

### [@firela/billclaw-ui](./packages/ui)

Unified UI + API service. React SPA + Hono API on Cloudflare Workers.

- Plaid Link and GoCardless web interface
- Gmail OAuth web interface
- Connection management dashboard

### [@firela/runtime-adapters](./packages/runtime-adapters)

Platform adapters for Cloudflare Workers and Node.js runtimes.

## License

AGPL-3.0 — see [LICENSE](./LICENSE) for details.

## Links

- [Documentation](https://docs.firela.io)
- [GitHub](https://github.com/fire-la/firela-bot)
- [npm](https://www.npmjs.org/@firela)
