/**
 * CLI command framework
 *
 * Base command interface and utilities using Commander.js.
 */

import { Command } from "commander"
import type { CliRuntimeContext } from "../runtime/context.js"

/**
 * CLI execution context
 */
export interface CliContext {
  runtime: CliRuntimeContext
  program: Command
}

/**
 * CLI command handler
 */
export type CliCommandHandler = (
  context: CliContext,
  args?: Record<string, unknown>,
) => Promise<void> | void

/**
 * CLI command option
 */
export interface CliCommandOption {
  flags: string
  description: string
  default?: string | boolean | string[]
}

/**
 * CLI command configuration
 */
export interface CliCommand {
  name: string
  description: string
  aliases?: string[]
  arguments?: string
  options?: CliCommandOption[]
  handler: CliCommandHandler
}

/**
 * CLI command registry
 */
export class CommandRegistry {
  private commands = new Map<string, CliCommand>()
  private program: Command

  constructor(program: Command) {
    this.program = program
  }

  /**
   * Register a command
   */
  register(command: CliCommand): void {
    this.commands.set(command.name, command)

    const cmd = this.program
      .command(command.name)
      .description(command.description)

    if (command.aliases && command.aliases.length > 0) {
      cmd.aliases(command.aliases)
    }

    if (command.arguments) {
      cmd.arguments(command.arguments)
    }

    if (command.options) {
      for (const opt of command.options) {
        if (opt.default !== undefined) {
          cmd.option(opt.flags, opt.description, opt.default)
        } else {
          cmd.option(opt.flags, opt.description)
        }
      }
    }

    cmd.action(async (...args: unknown[]) => {
      const { createRuntimeContext } = await import("../runtime/context.js")
      const runtime = createRuntimeContext()

      const context: CliContext = {
        runtime,
        program: this.program,
      }

      try {
        // Commander 13+ passes: [positional1, positional2, ..., options, command]
        // The last parameter is Command object, second to last is options
        const hasCommand = args.length > 0 && args[args.length - 1] instanceof Command
        const optionsIndex = hasCommand ? args.length - 2 : args.length - 1
        const options = (
          args.length > 0 && args[optionsIndex] && typeof args[optionsIndex] === 'object'
            ? args[optionsIndex]
            : {}
        ) as Record<string, unknown>

        // Extract positional arguments if defined
        // Commander passes positional args before the options object
        const mergedOptions = { ...options }
        if (command.arguments) {
          // Parse argument names from the arguments string (e.g., "<file>" -> "file")
          const argNames = command.arguments
            .split(/\s+/)
            .map((arg) => arg.replace(/[<>[\]]/g, ""))

          // Map positional args to their names
          // args = [positional1, positional2, ..., options, command]
          const positionalCount = optionsIndex
          for (let i = 0; i < Math.min(argNames.length, positionalCount); i++) {
            const argValue = args[i]
            if (argValue !== undefined && argValue !== options) {
              mergedOptions[argNames[i]] = argValue
            }
          }
        }

        await command.handler(context, mergedOptions)
      } catch (error) {
        runtime.logger.error("Command failed:", error)
        // Set exitCode instead of calling process.exit so buffered
        // stdout/stderr (pipes) flush before the process terminates.
        process.exitCode = 1
      }
    })
  }

  /**
   * Get a registered command
   */
  get(name: string): CliCommand | undefined {
    return this.commands.get(name)
  }

  /**
   * Get all registered commands
   */
  getAll(): CliCommand[] {
    return Array.from(this.commands.values())
  }

  /**
   * Check if a command exists
   */
  has(name: string): boolean {
    return this.commands.has(name)
  }
}
