# BillClaw

Financial data sovereignty with multi-platform plugin architecture.

## Overview

BillClaw is an open-source financial data import system that puts you in control of your financial data. Instead of storing your banking credentials with third-party services, BillClaw stores them locally and syncs transactions directly to your own storage.

### Key Features

- **Data Sovereignty**: Your credentials stay on your machine
- **Multi-Source**: Import from Plaid, Gmail, and GoCardless
- **Flexible Export**: Export to Beancount, Ledger, or CSV
- **Framework Agnostic**: Use with OpenClaw, as a CLI, or as a library
- **Local Storage**: All data stored locally with optional encryption
- **Real-time Sync**: Webhook support for instant transaction updates

## Production Deployment

For real bank authentication (not sandbox), you need an external accessible URL since Plaid callbacks cannot reach `localhost`.

### Cloudflare Workers (Recommended)

The easiest way to deploy BillClaw for production use:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/fire-la/firela-bot/tree/main/packages/ui)

**Benefits:**
- Zero infrastructure management
- Global edge network (300+ locations)
- Automatic HTTPS
- Generous free tier
- One-click deployment per service

See the [Cloudflare Deployment Guide](./billclaw-docs/docs/guide/cloudflare-deployment.md) for detailed instructions.

## Architecture

BillClaw uses a **Framework-Agnostic Core + Adapter Pattern** architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                      BillClaw Monorepo                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │  OpenClaw Plugin │  │   Standalone CLI │               │
│  │  (AI Framework)  │  │   (Terminal)     │               │
│  └────────┬─────────┘  └────────┬─────────┘               │
│           │                      │                          │
│           └──────────┬───────────┘                          │
│                      ▼                                      │
│           ┌────────────────────┐                           │
│           │  @firela/billclaw-core  │                     │
│           │  (Framework-Agnostic) │                         │
│           │  ├─ oauth/           │                         │
│           │  ├─ models/          │                         │
│           │  ├─ storage/         │                         │
│           │  └─ sources/         │                         │
│           └────────┬────────────┘                           │
│                      │                                      │
│           ┌──────────┴──────────────────────┐             │
│           ▼                                 ▼             │
│    ┌──────────────┐              ┌──────────────┐       │
│    │  OpenClaw... │              │     CLI      │       │
│    │  Adapter     │              │   Adapter    │       │
│    └──────────────┘              └──────────────┘       │
│           │                                 │             │
│           └──────────┬──────────────────────────┘        │
│                      ▼                                   │
│           ┌────────────────────┐                        │
│           │  @firela/billclaw-ui  │                      │
│           │  (Unified UI + API)   │                      │
│           │  └─ React SPA        │                        │
│           │  └─ Hono API Server  │                        │
│           │  └─ Cloudflare Workers │                     │
│           └────────────────────┘                        │
│                                                          │
└─────────────────────────────────────────────────────────────┘
```

**Key Changes (Phase 13 - 2026-03)**:
- ✅ Unified UI + API service in `@firela/billclaw-ui`
- ✅ Single port (8787) for both UI and API
- ✅ Cloudflare Workers deployment with Hono
- ✅ Complete OAuth flow with web UI

For detailed architecture documentation, see [docs/architecture.md](./docs/architecture.md).

## Packages

### [@firela/billclaw-core](./packages/core)

Framework-agnostic core business logic. This package contains all the functionality with zero dependencies on any AI framework.

- Data models with Zod validation
- Transaction storage with caching and indexing
- Plaid and Gmail integration
- Beancount and Ledger exporters
- Security: keychain integration and audit logging

### [@firela/billclaw-openclaw](./packages/openclaw)

OpenClaw plugin adapter. Integrates BillClaw with the OpenClaw AI framework.

- 6 agent tools (plaid_sync, gmail_fetch, bill_parse, etc.)
- 4 CLI commands (bills setup, sync, status, config)
- 2 OAuth providers (Plaid, Gmail)
- 2 background services (sync, webhook)

### [@firela/billclaw-cli](./packages/billclaw/cli)

Standalone command-line interface. Use BillClaw without any AI framework.

- Interactive setup wizard
- Transaction sync and status monitoring
- Configuration management
- Export to Beancount/Ledger
- Import from CSV/OFX/QFX

### [@firela/billclaw-ui](./packages/ui)

Unified UI + API service for BillClaw configuration and OAuth flows.

- React SPA with Tailwind CSS
- Hono API server on Cloudflare Workers
- Plaid Link web interface
- Gmail OAuth web interface
- Single port for UI and API (default: 8787)

**Usage**:
```bash
# Start UI server
billclaw ui

# Or with custom port
billclaw ui --port 8787

# Visit http://localhost:8787
```

## Quick Start

### Using UI Service (Recommended)

The easiest way to connect your financial accounts:

```bash
# 1. Clone and build
git clone https://github.com/fire-la/firela-bot.git
cd billclaw
pnpm install && pnpm build

# 2. Start the UI service
billclaw ui

# 3. Open your browser
# Visit http://localhost:8787
```

### As OpenClaw Plugin

```bash
cd ~/.openclaw/extensions
npm install @firela/billclaw-openclaw
```

### As Standalone CLI

```bash
npm install -g @firela/billclaw-cli
billclaw setup
billclaw sync
```

### As a Library

```bash
npm install @firela/billclaw-core
```

```typescript
import { Billclaw } from "@firela/billclaw-core";

const billclaw = new Billclaw(runtime);
await billclaw.syncPlaid();
const transactions = await billclaw.getTransactions("all", 2024, 1);
```

## Development

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0

### Setup

```bash
# Clone repository
git clone https://github.com/fire-la/firela-bot.git
cd billclaw

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Scripts

```bash
pnpm build           # Build all packages
pnpm test            # Run all tests
pnpm lint            # Lint all packages
pnpm format          # Format all code
pnpm clean           # Clean build artifacts
```

### Project Structure

```
billclaw/
├── packages/
│   ├── billclaw/
│   │   ├── core/      # Framework-agnostic core
│   │   └── cli/       # Standalone CLI
│   ├── ui/            # Unified UI + API service
│   ├── firela-bot/    # Discord bot
│   └── runtime-adapters/ # Runtime adapters
├── billclaw-docs/
│   ├── docs/          # Documentation
│   └── testing/       # E2E tests
├── .github/
│   └── workflows/     # CI/CD pipelines
├── .husky/            # Pre-commit hooks
├── pnpm-workspace.yaml
└── package.json
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

AGPL-3.0 - see [LICENSE](./LICENSE) file for details.

## Acknowledgments

- [Plaid](https://plaid.com/) - Bank account API
- [OpenClaw](https://openclaw.dev) - AI framework
- [Beancount](https://beancount.github.io/) - Plain text accounting

## Links

- [GitHub](https://github.com/fire-la/firela-bot)
- [npm](https://www.npmjs.com/org/fire-la)
- [Documentation](https://github.com/fire-la/firela-bot/wiki)
