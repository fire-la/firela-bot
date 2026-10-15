/**
 * Import command - imports CSV files and parses and uploads transactions to VLT.
 *
 * @module @firela/billclaw-cli
 */

import { existsSync, readFileSync } from "node:fs"
import type { CliCommand, CliContext } from "./registry.js"
import { Spinner } from "../utils/progress.js"
import { success } from "../utils/format.js"
import {
  parserRegistry,
  PARSER_PLATFORM_CANONICAL,
  resolveParserName,
  transformParsedTransactions,
  transformParsedBillTransactions,
  type ParserName,
} from "@firela/billclaw-core/parsers"
import {
  uploadTransactions,
  uploadParsedBillTransactions,
  type PlaidTransactionUpload,
  type ParsedBillTransactionUpload,
  type ProviderSyncConfig,
} from "@firela/billclaw-core"
import { VltAuthManager } from "@firela/billclaw-core"
import { createCredentialStore, CredentialStrategy } from "@firela/billclaw-core"

/**
 * Run import command
 */
async function runImport(
  context: CliContext,
  args: {
    file?: string
    parser?: string
    account?: string
    dryRun?: boolean
  },
): Promise<void> {
  const filePath = args.file
  const accountId = args.account
  const dryRun = args.dryRun ?? false

  // Validate file path
  if (!filePath) {
    console.error("Error: File path is required")
    console.error("Usage: billclaw import <file> [options]")
    return
  }

  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`)
    return
  }

  // Validate a requested parser up front (accepts legacy aliases) — an
  // invalid name gets a friendly error listing the choices instead of an
  // unhandled cast crash later.
  let requestedParser: ParserName | undefined
  if (args.parser) {
    try {
      requestedParser = resolveParserName(args.parser)
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
      return
    }
  }

  const spinner = new Spinner({ text: "Reading file..." }).start()

  // Read file content
  let content: Buffer
  try {
    content = readFileSync(filePath)
  } catch (err) {
    spinner.fail(`Failed to read file: ${(err as Error).message}`)
    return
  }

  // Auto-detect parser if not specified
  let detectedParserName: ParserName | null = requestedParser ?? null
  if (!detectedParserName) {
    spinner.update("Detecting file format...")
    detectedParserName = await parserRegistry.detect(content)
    if (!detectedParserName) {
      spinner.fail("Could not detect file format")
      console.error("")
      console.error("Available parsers:")
      for (const name of parserRegistry.list()) {
        console.error(`  - ${name}`)
      }
      console.error("")
      console.error("Use --parser <name> to specify a parser.")
      return
    }
  }

  spinner.update(`Parsing with ${detectedParserName}...`)

  // Get parser and parse file. parse() can REJECT (the wasm loaders reject
  // stickily when instantiation fails) — fail friendly like the errors above
  // instead of an unhandled rejection with a dangling spinner.
  const parser = parserRegistry.get(detectedParserName)
  let result: Awaited<ReturnType<typeof parser.parse>>
  try {
    result = await parser.parse(content)
  } catch (err) {
    spinner.fail(`Parser ${detectedParserName} failed to load or run: ${(err as Error).message}`)
    return
  }

  if (!result.success) {
    spinner.fail("Parse failed")
    console.error("")
    console.error("Errors:")
    for (const error of result.errors) {
      console.error(`  - ${error.code}: ${error.message}`)
    }
    return
  }

  spinner.succeed(`Parsed ${result.data.length} transaction(s)`)

  // For dry-run without account, show sample data without transformation
  if (dryRun && !accountId) {
    console.log("")
    console.log("Dry run mode - skipping upload")
    console.log("")
    console.log("Sample raw transactions:")
    for (const txn of result.data.slice(0, 3)) {
      console.log(`  - ${txn.date}: ${txn.payee} (${txn.amount} ${txn.currency})`)
    }
    if (result.data.length > 3) {
      console.log(`  ... and ${result.data.length - 3} more`)
    }
    return
  }

  // Check account ID for transformation
  if (!accountId) {
    console.error("")
    console.error("Error: Account ID is required for upload")
    console.error("Use --account <id> to specify the target account")
    console.error("")
    console.error("For dry-run without upload, use --dry-run without --account")
    return
  }

  // CN parsers ride the parsed-bill transport (#45); EU/HK keep the plaid
  // transport. The transport comes from the REGISTRY entry — platform
  // presence is NOT the discriminator (4 of 5 non-CN crates also carry a
  // platform canonical; eu-degiro deliberately does not). Every CN parser
  // has a platform canonical (pinned by registry.test's exhaustive test), so
  // the lookup is total on the parsed-bill branch.
  const transport = parserRegistry.transport(detectedParserName)
  const payload: ImportPayload =
    transport === "parsed-bill"
      ? {
          transport,
          platform: PARSER_PLATFORM_CANONICAL[detectedParserName]!,
          rows: transformParsedBillTransactions(result.data),
        }
      : {
          transport,
          rows: transformParsedTransactions(result.data, {
            accountId: accountId,
            pending: false,
          }),
        }

  console.log(`Transformed ${payload.rows.length} transaction(s) for upload`)

  if (dryRun) {
    console.log("")
    console.log("Dry run mode - skipping upload")
    console.log("")
    console.log("Sample transactions:")
    const sample: string[] =
      payload.transport === "parsed-bill"
        ? payload.rows
            .slice(0, 3)
            .map((r) => `${r.date}: ${r.description} (${r.amount} ${r.currency})`)
        : payload.rows
            .slice(0, 3)
            .map((r) => `${r.date}: ${r.name} (${r.amount} ${r.iso_currency_code})`)
    for (const line of sample) {
      console.log(`  - ${line}`)
    }
    if (payload.rows.length > 3) {
      console.log(`  ... and ${payload.rows.length - 3} more`)
    }
    return
  }

  // Upload to VLT
  await handleUpload(context, payload, accountId)
}

/**
 * Upload payload pairing the transport with its row shape (compile-time).
 * parsed-bill = the CN bill leg (#45); plaid = everything else, unchanged.
 */
type ImportPayload =
  | { transport: "plaid"; rows: PlaidTransactionUpload[] }
  | { transport: "parsed-bill"; platform: string; rows: ParsedBillTransactionUpload[] }

/**
 * Handle VLT upload
 *
 * CN bill parsers upload through the parsed-bill transport (#45): `accountId`
 * then rides config.externalAccountId (looked up against provider='parsed-bill'
 * ExternalAccountLink rows on vlt, falling back to sourceAccount on miss) and
 * the payload's platform carries the canonical for method-namespace funding
 * routing. Non-CN parsers keep the legacy plaid transport untouched.
 */
async function handleUpload(
  context: CliContext,
  payload: ImportPayload,
  accountId: string,
): Promise<void> {
  const { runtime } = context
  const config = await runtime.config.getConfig()

  // Check if VLT is configured
  if (!config.vlt?.accessToken) {
    console.error("")
    console.error("Error: VLT not configured")
    console.error("Run 'billclaw config' to set up VLT credentials")
    return
  }

  if (!config.vlt?.upload) {
    console.error("")
    console.error("Error: VLT upload configuration missing")
    console.error("Run 'billclaw config' to configure upload settings")
    return
  }

  // CN bills must sync under region 'cn': vlt loads funding-route account
  // templates from the request :region, so a CN bill under 'us' can never
  // resolve generic wallet-balance-style tokens. The legacy plaid transport masked
  // this because its rule engine derived region from the sourceAccount path —
  // fail loud instead of silently misrouting (#45).
  if (payload.transport === "parsed-bill" && config.vlt.region !== "cn") {
    console.error("")
    console.error(`Error: CN bill import requires VLT region 'cn' (current: '${config.vlt.region}')`)
    console.error("vlt loads funding-source account templates per region, so a CN")
    console.error("bill synced under another region cannot resolve payment-method routing.")
    console.error("")
    console.error("Fix: set region to 'cn' in your VLT config (billclaw config) or the")
    console.error("vlt.region setting, then re-run the import.")
    process.exit(1)
  }

  const spinner = new Spinner({ text: "Uploading to VLT..." }).start()

  try {
    // Create credential store for JWT token caching
    const credentialStore = createCredentialStore({
      strategy: CredentialStrategy.KEYCHAIN,
      logger: runtime.logger,
    })

    // Use VltAuthManager for token management
    const authManager = new VltAuthManager(config.vlt, credentialStore, runtime.logger)
    const apiToken = await authManager.ensureValidToken()

    // Build sync config from VLT config
    const syncConfig: ProviderSyncConfig = {
      sourceAccount: config.vlt.upload.sourceAccount,
      defaultCurrency: config.vlt.upload.defaultCurrency || "USD",
      defaultExpenseAccount: config.vlt.upload.defaultExpenseAccount || "Expenses:Unknown",
      defaultIncomeAccount: config.vlt.upload.defaultIncomeAccount || "Income:Unknown",
      filterPending: config.vlt.upload.filterPending ?? true,
      // CN leg (#45): per-invocation routing key — the parsed-bill batch
      // external id, resolved against provider='parsed-bill' account links
      // on vlt (sourceAccount fallback when no link matches). Non-CN parsers
      // keep per-row routing via the plaid transform and send no batch id.
      ...(payload.transport === "parsed-bill"
        ? { externalAccountId: accountId, platform: payload.platform }
        : {}),
    }

    const vltConfig = {
      apiUrl: config.vlt.apiUrl,
      apiToken,
      region: config.vlt.region,
    }

    const result =
      payload.transport === "parsed-bill"
        ? await uploadParsedBillTransactions(
            vltConfig,
            payload.rows,
            syncConfig,
            runtime.logger,
          )
        : await uploadTransactions(vltConfig, payload.rows, syncConfig, runtime.logger)

    spinner.succeed("Upload complete")

    console.log("")
    console.log("Upload Results:")
    console.log(`  Imported: ${result.imported}`)
    console.log(`  Skipped: ${result.skipped}`)
    console.log(`  Pending Review: ${result.pendingReview}`)
    console.log(`  Failed: ${result.failed}`)

    if (result.failed > 0) {
      console.log("")
      console.log("Some transactions failed to import. Check VLT for details.")
    }

    success("Import completed!")
  } catch (err) {
    spinner.fail("Upload failed")
    const errorMessage =
      err && typeof err === "object" && "humanReadable" in err
        ? (err as { humanReadable: { message: string } }).humanReadable.message
        : err instanceof Error
          ? err.message
          : String(err)
    console.error(`  ${errorMessage}`)
    throw err
  }
}

/**
 * Import command definition
 */
export const importCommand: CliCommand = {
  name: "import",
  description: "Import transactions from CSV file",
  arguments: "<file>",
  options: [
    {
      flags: "-p, --parser <name>",
      description: "Parser to use (auto-detect if not specified)",
    },
    {
      flags: "-a, --account <id>",
      description:
        "External account ID for upload routing (CN bills: matched against parsed-bill account links)",
    },
    {
      flags: "-d, --dry-run",
      description: "Parse only, do not upload",
    },
  ],
  handler: (context, args) =>
    runImport(context, args as {
      file?: string
      parser?: string
      account?: string
      dryRun?: boolean
    }),
}
