# Security Policy

## Overview

BillClaw is an **open-source**, **local-first** financial data management tool. This document addresses security concerns and provides transparency about our security architecture.

## Why BillClaw is Safe

### 1. Fully Transparent Codebase

All BillClaw packages are open-source and available for audit:

| Package | npm Registry | Source Code |
|---------|--------------|-------------|
| `@firela/billclaw-core` | [npmjs.com](https://www.npmjs.com/package/@firela/billclaw-core) | [GitHub](https://github.com/fire-la/firela-bot/tree/main/packages/core) |
| `@firela/billclaw-openclaw` | [npmjs.com](https://www.npmjs.com/package/@firela/billclaw-openclaw) | [GitHub](https://github.com/fire-la/firela-bot/tree/main/packages/openclaw) |
| `@firela/billclaw-cli` | [npmjs.com](https://www.npmjs.com/package/@firela/billclaw-cli) | [GitHub](https://github.com/fire-la/firela-bot/tree/main/packages/cli) |
| `@firela/billclaw-connect` | [npmjs.com](https://www.npmjs.com/package/@firela/billclaw-connect) | [GitHub](https://github.com/fire-la/firela-bot/tree/main/packages/connect) |

### 2. npm Provenance (Supply Chain Security)

All packages are published with **npm provenance**, providing verifiable links between published packages and source code:

```
npm audit @firela/billclaw-openclaw
```

Provenance verifies:
- Package was built from the claimed source repository
- Build process was not tampered with
- Cryptographic proof of origin

### 3. No Data Exfiltration

**BillClaw NEVER sends your data to external servers:**

- ✅ Financial data stored locally in `~/.firela/billclaw/`
- ✅ API calls go directly to Plaid/Gmail (not through our servers)
- ✅ OAuth tokens stored in your system keychain
- ✅ No telemetry, no analytics, no phone-home

### 4. User-Controlled Credentials

**You provide and control all API credentials:**

- Plaid/Gmail credentials come from YOUR accounts
- Credentials are stored in YOUR system keychain
- BillClaw cannot access credentials without your explicit action
- No shared or embedded credentials

### 5. Explicit User Invocation

The skill is configured with `disable-model-invocation: true`, meaning:

- OpenClaw CANNOT autonomously invoke BillClaw tools
- Every action requires explicit user request
- No background operations without user knowledge

## Addressing Security Scanner Findings

### Detection: `sets-process-name` / `detect-debug-environment`

These detections come from **transitive npm dependencies** (dependencies of dependencies), not BillClaw code:

- These are common patterns in Node.js ecosystem
- Used by legitimate packages for process management
- Not used for malicious purposes in BillClaw
- Source: Review our code at [GitHub](https://github.com/fire-la/firela-bot)

### Detection: Sensitive API Requirements

**This is by design** - BillClaw needs API credentials to function:

| Credential | Purpose | Storage |
|------------|---------|---------|
| Plaid Client ID/Secret | Connect to your bank | System keychain |
| Gmail Client ID/Secret | Fetch bills from email | System keychain |

**These credentials are:**
- Obtained from YOUR developer accounts (Plaid Dashboard, Google Cloud Console)
- Stored securely in YOUR system keychain
- Never transmitted to BillClaw servers

### Detection: External npm Dependencies

**All npm packages are:**
- Published to npmjs.com with provenance
- Open-source and auditable
- Version-pinned for reproducibility
- Verified via `npm audit`

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Your Machine                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  BillClaw (Local)                                           │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐  │   │
│  │  │ Local Storage │  │ System Keychain │  │ Config Files  │  │   │
│  │  │ ~/.firela/    │  │ (encrypted)    │  │ ~/.firela/     │  │   │
│  │  └───────────────┘  └───────────────┘  └────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              │ Direct API calls (your credentials) │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  External APIs                                              │   │
│  │  ┌───────────────┐              ┌───────────────────────┐   │   │
│  │  │ Plaid API     │              │ Gmail API             │   │   │
│  │  │ (Bank data)   │              │ (Bill fetching)       │   │   │
│  │  └───────────────┘              └───────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

Note: No data flows through BillClaw servers
```

## How to Verify BillClaw's Security

### 1. Audit the Source Code

```bash
git clone https://github.com/fire-la/firela-bot
cd billclaw
pnpm install
pnpm build
# Review the code
```

### 2. Verify npm Package Integrity

```bash
# Check package provenance
npm audit @firela/billclaw-openclaw

# Verify package signature
npm view @firela/billclaw-openclaw --json | jq '.dist'
```

### 3. Monitor Network Traffic

```bash
# Run BillClaw with network monitoring
# You'll see only direct API calls to Plaid/Gmail
# No calls to billclaw-specific servers
```

### 4. Check Local Storage

```bash
# All your data is here:
ls -la ~/.firela/billclaw/

# Credentials are in system keychain:
# macOS: Keychain Access app
# Linux: gnome-keyring / kwallet
# Windows: Windows Credential Manager
```

## Reporting Security Issues

If you discover a security vulnerability, please report it privately:

- **Email**: security@fire-la.dev
- **PGP Key**: Available at https://github.com/fire-la/firela-bot/security

We will:
1. Acknowledge receipt within 48 hours
2. Provide a detailed response within 7 days
3. Credit you in our security advisories (if desired)

## Security Best Practices for Users

1. **Keep packages updated**: `npm update @firela/billclaw-openclaw`
2. **Review permissions**: Only grant API credentials you need
3. **Use environment variables**: Don't commit credentials to code
4. **Enable keychain storage**: Let BillClaw use your system keychain
5. **Audit regularly**: Review your local data periodically

## License

BillClaw is released under the GNU Affero General Public License v3.0. See [LICENSE](https://github.com/fire-la/firela-bot/blob/main/LICENSE) for details.

---

**Last Updated**: 2025-02-13
**Version**: 0.5.4
