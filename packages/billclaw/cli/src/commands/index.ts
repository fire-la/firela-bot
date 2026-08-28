/**
 * CLI commands module
 *
 * All available CLI commands.
 */

export {
  CommandRegistry,
  type CliCommand,
  type CliContext,
  type CliCommandHandler,
} from "./registry.js"
export { setupCommand } from "./setup.js"
export { syncCommand } from "./sync.js"
export { statusCommand } from "./status.js"
export { configCommand } from "./config.js"
export { exportCommand } from "./export.js"
export { webhookTestCommand } from "./webhook.js"
export {
  webhookReceiverConfigCommand,
  webhookReceiverStatusCommand,
  webhookReceiverEnableCommand,
  webhookReceiverDisableCommand,
} from "./webhook-receiver.js"
export { uploadCommand } from "./upload.js"
export { uiCommand } from "./ui.js"
export { importCommand } from "./import.js"
export { discoverCommand } from "./discover.js"
/**
 * All commands to register
 */
export const allCommands = [
  { setup: () => import("./setup.js").then((m) => m.setupCommand) },
  { sync: () => import("./sync.js").then((m) => m.syncCommand) },
  { status: () => import("./status.js").then((m) => m.statusCommand) },
  { config: () => import("./config.js").then((m) => m.configCommand) },
  { export: () => import("./export.js").then((m) => m.exportCommand) },
  { webhook: () => import("./webhook.js").then((m) => m.webhookTestCommand) },
  { "webhook-receiver-config": () => import("./webhook-receiver.js").then((m) => m.webhookReceiverConfigCommand) },
  { "webhook-receiver-status": () => import("./webhook-receiver.js").then((m) => m.webhookReceiverStatusCommand) },
  { "webhook-receiver-enable": () => import("./webhook-receiver.js").then((m) => m.webhookReceiverEnableCommand) },
  { "webhook-receiver-disable": () => import("./webhook-receiver.js").then((m) => m.webhookReceiverDisableCommand) },
  { upload: () => import("./upload.js").then((m) => m.uploadCommand) },
  { ui: () => import("./ui.js").then((m) => m.uiCommand) },
  { import: () => import("./import.js").then((m) => m.importCommand) },
  { discover: () => import("./discover.js").then((m) => m.discoverCommand) },
  { upgrade: () => import("./upgrade.js").then((m) => m.upgradeCommand) },
  { uninstall: () => import("./uninstall.js").then((m) => m.uninstallCommand) },
  { deploy: () => import("./deploy.js").then((m) => m.deployCommand) },
]
