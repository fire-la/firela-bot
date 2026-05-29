# Changelog

## 0.5.5

### Patch Changes

- Patch release with bug fixes and deployment improvements
- Updated dependencies
  - @firela/billclaw-core@0.5.5

## 0.5.4

### Patch Changes

- Fix SKILL.md inconsistencies for OpenClaw security compliance.

  **Problem**: Security scan flagged two inconsistencies:

  1. Package name mismatch between SKILL.md and registry metadata
  2. Contradictory "No external code execution" statement

  **Changes**:

  1. Add @firela/billclaw-openclaw as primary (required) install entry
  2. Update Security Guarantee to clarify:
     - Skill provides installation instructions
     - Code execution handled by installed npm packages
     - All packages are transparent and auditable
  3. Add Package Overview section labeling required vs optional

  **Metadata updates**:

  - install[0]: @firela/billclaw-openclaw (required)
  - install[1]: @firela/billclaw-cli (optional)
  - install[2]: @firela/billclaw-connect (optional)

- Updated dependencies
  - @firela/billclaw-core@0.5.4

## 0.5.3

### Patch Changes

- Fix SKILL.md metadata format to match OpenClaw official standard.

  Change metadata from single-line JSON string to multi-line YAML
  nested JSON object format. This fixes ClawHub registry parsing issues
  where metadata (requires.env, install specs) was not properly recognized.

  **Before (single-line JSON):**

  ```yaml
  metadata: { "openclaw": { "requires": { "env": [...] } } }
  ```

  **After (multi-line YAML nested JSON):**

  ```yaml
  homepage: https://github.com/fire-la/firela-bot
  metadata:
    {
      "openclaw":
        {
          "emoji": "💰",
          "requires": { "env": [...], "anyBins": [...] },
          "primaryEnv": "PLAID_CLIENT_ID",
          "install": [...],
        },
    }
  ```

  This matches the format used by official OpenClaw skills and ensures
  proper parsing by ClawHub registry.

- Updated dependencies
  - @firela/billclaw-core@0.5.3

## 0.5.2

### Patch Changes

- SKILL.md security optimization for VirusTotal compliance:
  - Add prominent Security Guarantee section
  - Remove direct npm install commands (use metadata instead)
  - Emphasize all packages are verified npm packages
  - Reference documentation for detailed setup
  - Clarify skill is documentation-only
- Updated dependencies
  - @firela/billclaw-core@0.5.2

## 0.5.1

### Patch Changes

- Version bump to 0.5.1 for ClawHub security compliance release
- Updated dependencies
  - @firela/billclaw-core@0.5.1

## 0.5.0

### Minor Changes

- 0080d71: Add OpenClaw skill metadata for ClawHub security compliance:
  - Declare required credentials (PLAID_CLIENT_ID, PLAID_SECRET, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET)
  - Set disable-model-invocation for sensitive financial data handling
  - Add optional install specs for CLI and Connect components
  - Update documentation to clarify plugin-based architecture

### Patch Changes

- 1bf6e7d: Version bump to 0.5.1
- Updated dependencies [1bf6e7d]
- Updated dependencies [0080d71]
  - @firela/billclaw-core@0.5.0

## 0.4.0

### Minor Changes

- e871be0: Add security declaration and clarify installation for OpenClaw users:

  - Add Security & Privacy section with keychain storage explanation
  - Add Credential Storage Summary table
  - Split Installation into OpenClaw and CLI sections
  - Clarify OpenClaw users don't need external npm packages
  - Add Security Disclosure section with vulnerability reporting

  This addresses the 'Suspicious' security scan label by providing
  transparency about security architecture and data handling practices.

### Patch Changes

- Updated dependencies [e871be0]
  - @firela/billclaw-core@0.4.0

## 0.3.0

### Minor Changes

- 7ca5691: Add AI-friendly error handling with dual-mode output optimized for AI agents

  - Enhanced UserError interface with machine-readable fields (errorCode, severity, recoverable, nextActions, entities)
  - Added ERROR_CODES constant with 30+ error codes for programmatic handling
  - Updated all Result interfaces to use UserError[] instead of string[]
  - Implemented dual-mode output in OpenClaw tools (machine-readable + human-readable)
  - Added exponential backoff retry for Plaid API calls (retryPlaidCall)
  - Updated all error parsers (parsePlaidError, parseGmailError, parseNetworkError, parseFileSystemError)
  - Added formatError() utility for CLI display

### Patch Changes

- Updated dependencies [7ca5691]
  - @firela/billclaw-core@0.3.0

## 0.2.0

### Minor Changes

- f46be36: Add BillClaw Connect OAuth server and webhook support

### Patch Changes

- Updated dependencies [f46be36]
  - @firela/billclaw-core@0.2.0

## 0.1.3

### Patch Changes

- Restore original publish workflow configuration to fix npm publishing.
- Updated dependencies
  - @firela/billclaw-core@0.1.3

## 0.1.2

### Patch Changes

- Update npm token and test publishing version 0.1.2.
- Updated dependencies
  - @firela/billclaw-core@0.1.2

## 0.1.1

### Patch Changes

- Fix npm publish workflow and release version 0.1.1.
- Updated dependencies
  - @firela/billclaw-core@0.1.1

## 0.1.0

### Minor Changes

- 12a088e: Implement automated version management with changesets. Added GitHub Actions workflow for automatic version PRs and publishing.

### Patch Changes

- Updated dependencies [12a088e]
  - @firela/billclaw-core@0.1.0

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release of @fire-zu/billclaw-cli
- Standalone CLI tool for financial data management
- Interactive setup wizard (billclaw setup)
- Manual sync command (billclaw sync)
- Status monitoring command (billclaw status)
- Configuration management (billclaw config)
- Export to Beancount and Ledger (billclaw export)
- Import from CSV/OFX/QFX (billclaw import)
- Colored console output with status badges
- Progress spinners for async operations
- Table formatting for account display
- File-based configuration at ~/.firela/billclaw/config.json
- CLI runtime adapter with console logger
- In-memory event emitter for CLI usage
