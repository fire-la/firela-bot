---
name: billclaw
description: This skill should be used when managing financial data, syncing bank transactions via Plaid/GoCardless, fetching bills from Gmail, or exporting to Beancount/Ledger formats. Provides local-first data sovereignty for OpenClaw users.
tags: [finance, banking, plaid, gocardless, gmail, beancount, ledger, transactions]
homepage: https://github.com/fire-la/firela-bot
metadata:
  {
    "openclaw":
      {
        "emoji": "💰",
        "requires":
          {
            "anyBins": ["node"],
          },
        "install":
          [
            {
              "id": "openclaw",
              "kind": "node",
              "package": "@firela/billclaw-openclaw",
              "label": "Install BillClaw OpenClaw plugin (required)",
            },
            {
              "id": "cli",
              "kind": "node",
              "package": "@firela/billclaw-cli",
              "bins": ["billclaw"],
              "label": "Install BillClaw CLI (optional)",
              "condition": "optional",
            },
            {
              "id": "connect",
              "kind": "node",
              "package": "@firela/billclaw-connect",
              "label": "Install BillClaw Connect OAuth server (optional)",
              "condition": "optional",
            },
          ],
      },
  }
disable-model-invocation: true
---

# BillClaw - Financial Data Management for OpenClaw

Complete financial data management for OpenClaw with local-first architecture. Sync bank transactions, fetch bills from email, and export to accounting formats.

## Security & Trust

**BillClaw is safe, open-source software designed with security-first principles.**

### Verification

- **Transparent packages**: All npm packages are open-source and published with provenance
- **Auditable code**: Full source available at [GitHub](https://github.com/fire-la/firela-bot)
- **npm provenance**: Cryptographic proof linking packages to source code
- **Local-first**: Your financial data never leaves your machine
- **User-controlled credentials**: You provide all API credentials through your own accounts
- **System keychain**: Tokens encrypted in your platform's secure keychain
- **Explicit invocation**: Requires explicit user action (`disable-model-invocation: true`)

See [SECURITY.md](./SECURITY.md) for detailed security architecture and verification steps.

### Addressing Security Concerns

| Concern | Explanation |
|---------|-------------|
| **sets-process-name** | Comes from transitive npm dependencies, not BillClaw code |
| **detect-debug-environment** | Common Node.js ecosystem pattern, not malicious |
| **API credentials** | Required for functionality; you control them from your accounts |
| **External packages** | All packages are open-source with npm provenance |

## Required Credentials

**Important**: Credentials are NOT required at install time. Configure them when you're ready to use specific features:

| Environment Variable | Purpose | Required For |
|---------------------|---------|--------------|
| `PLAID_CLIENT_ID` | Plaid API client ID | Plaid bank sync |
| `PLAID_SECRET` | Plaid API secret | Plaid bank sync |
| `GMAIL_CLIENT_ID` | Gmail OAuth client ID | Gmail bill fetching |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth client secret | Gmail bill fetching |

**Obtain credentials from:**
- **Plaid**: https://dashboard.plaid.com/
- **Gmail**: https://console.cloud.google.com/apis/credentials

**Configure via:**
1. Environment variables (recommended)
2. Configuration file (`~/.firela/billclaw/config.json`)
3. OpenClaw config under `skills.entries.billclaw.env`

## Quick Start (OpenClaw)

### 1. Install the Plugin

```bash
npm install @firela/billclaw-openclaw
```

The plugin registers these tools and commands with OpenClaw:
- **Tools**: `plaid_sync`, `gmail_fetch`, `conversational_sync`, `conversational_status`
- **Commands**: `/billclaw-setup`, `/billclaw-sync`, `/billclaw-status`, `/billclaw-config`

### 2. Configure Credentials

When you're ready to use a feature, configure the required credentials:

```bash
# For Plaid bank sync
export PLAID_CLIENT_ID="your_client_id"
export PLAID_SECRET="your_secret"

# For Gmail bill fetching
export GMAIL_CLIENT_ID="your_client_id"
export GMAIL_CLIENT_SECRET="your_secret"
```

### 3. Setup Your Accounts

```
/billclaw-setup
```

The interactive wizard will guide you through:
- Connecting bank accounts (Plaid/GoCardless)
- Configuring Gmail for bill fetching
- Setting local storage location

### 4. Sync Your Data

```
You: Sync my bank transactions for last month

OpenClaw: [Uses plaid_sync tool from BillClaw plugin]
Synced 127 transactions from checking account
```

Or use the command directly:
```
/billclaw-sync --from 2024-01-01 --to 2024-12-31
```

### 5. Export to Accounting Formats

```
/billclaw-export --format beancount --output 2024.beancount
```

## OpenClaw Integration

This skill provides instructions for using BillClaw with OpenClaw. The actual integration is provided by the **@firela/billclaw-openclaw** npm package.

### Available Tools (via Plugin)

- `plaid_sync` - Sync bank transactions from Plaid
- `gmail_fetch` - Fetch bills from Gmail
- `conversational_sync` - Natural language sync interface
- `conversational_status` - Check sync status

### Available Commands (via Plugin)

- `/billclaw-setup` - Configure accounts
- `/billclaw-sync` - Sync transactions
- `/billclaw-status` - View status
- `/billclaw-config` - Manage configuration

## Additional Components (Optional)

### Standalone CLI

For users who prefer a command-line interface, the standalone CLI is available as a separate npm package. See https://github.com/fire-la/firela-bot for installation instructions.

### Connect OAuth Server

For self-hosted OAuth flows, the Connect server is available as a separate npm package. See https://github.com/fire-la/firela-bot for configuration details.

## Data Sources

| Source | Description | Regions |
|--------|-------------|---------|
| **Plaid** | Bank transaction sync | US, Canada |
| **GoCardless** | European bank integration | Europe |
| **Gmail** | Bill fetching via email | Global |

## Storage

- **Location**: `~/.firela/billclaw/` (your home directory)
- **Format**: JSON files with monthly partitioning
- **Security**: Local-only storage

## Configuration

Configuration is stored in `~/.firela/billclaw/config.json`:

```json
{
  "plaid": {
    "clientId": "your_client_id",
    "secret": "your_secret",
    "environment": "sandbox"
  },
  "gmail": {
    "clientId": "your_gmail_client_id",
    "clientSecret": "your_gmail_client_secret"
  }
}
```

## Export Formats

### Beancount

```
2024/01/15 * "Starbucks"
  Expenses:Coffee
  Liabilities:CreditCard:Visa
    $5.50
```

### Ledger

```
2024/01/15 Starbucks
  Expenses:Coffee  $5.50
  Liabilities:Credit Card:Visa
```

## Getting Help

- **Documentation**: https://github.com/fire-la/firela-bot
- **Issues**: https://github.com/fire-la/firela-bot/issues
- **Security**: Report security vulnerabilities privately at security@fire-la.dev
- **npm packages**: https://www.npmjs.com/org/firela
