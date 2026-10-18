/**
 * ConfigManager unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  ConfigManager,
} from "./config-manager.js"
import { loadEnvOverrides, getEnvValue } from "./env-loader.js"

describe("ConfigManager", () => {
  let testConfigPath: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(async () => {
    // Create temp config file (mkdtemp: unique per creation - Date.now()
    // names collide across parallel test files, #64)
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "billclaw-test-"))
    testConfigPath = `${tmpDir}/config.json`

    // Save original env
    originalEnv = { ...process.env }

    // Reset singleton
    ConfigManager.resetInstance()
  })

  afterEach(async () => {
    // Cleanup
    try {
      await fs.unlink(testConfigPath)
    } catch {
      // Ignore
    }
    try {
      await fs.rmdir(path.dirname(testConfigPath))
    } catch {
      // Ignore
    }

    // Restore env
    process.env = originalEnv

    // Reset singleton
    ConfigManager.resetInstance()
  })

  describe("Singleton pattern", () => {
    it("should return the same instance on multiple getInstance calls", () => {
      const instance1 = ConfigManager.getInstance({ configPath: testConfigPath })
      const instance2 = ConfigManager.getInstance({ configPath: testConfigPath })
      expect(instance1).toBe(instance2)
    })

    it("should create new instance after reset", () => {
      const instance1 = ConfigManager.getInstance({ configPath: testConfigPath })
      ConfigManager.resetInstance()
      const instance2 = ConfigManager.getInstance({ configPath: testConfigPath })
      expect(instance1).not.toBe(instance2)
    })
  })

  describe("Config file loading", () => {
    it("should return default config when file doesn't exist", async () => {
      const manager = ConfigManager.getInstance({ configPath: testConfigPath })
      const config = await manager.getConfig()

      expect(config.version).toBe(1)
      expect(config.connect.port).toBe(4456)
      expect(config.connect.host).toBe("localhost")
      expect(config.plaid.environment).toBe("sandbox")
      expect(config.accounts).toEqual([])
    })

    it("should load and validate config from file", async () => {
      const testConfig = {
        version: 1,
        connect: { port: 3000, host: "0.0.0.0" },
        plaid: { environment: "development" },
        accounts: [],
        webhooks: [],
      }

      await fs.writeFile(testConfigPath, JSON.stringify(testConfig))

      const manager = ConfigManager.getInstance({ configPath: testConfigPath })
      const config = await manager.getConfig()

      expect(config.connect.port).toBe(3000)
      expect(config.connect.host).toBe("0.0.0.0")
      expect(config.plaid.environment).toBe("development")
    })

    it("should reject invalid config", async () => {
      const invalidConfig = {
        version: 1,
        connect: { port: "invalid" }, // Invalid: should be number
      }

      await fs.writeFile(testConfigPath, JSON.stringify(invalidConfig))

      const manager = ConfigManager.getInstance({ configPath: testConfigPath })

      await expect(manager.getConfig()).rejects.toThrow()
    })
  })

  describe("Config updates", () => {
    it("should update account configuration", async () => {
      // Create initial config with an account
      const testConfig = {
        version: 1,
        connect: { port: 4456, host: "localhost" },
        accounts: [
          { id: "acct_123", type: "plaid", name: "Test Account", enabled: false },
        ],
        webhooks: [],
      }

      await fs.writeFile(testConfigPath, JSON.stringify(testConfig))

      const manager = ConfigManager.getInstance({ configPath: testConfigPath })

      // Update account
      await manager.updateAccount("acct_123", { enabled: true, name: "Updated Account" })

      // Verify update persisted
      const config = await manager.getConfig()
      const account = config.accounts.find((a) => a.id === "acct_123")

      expect(account?.enabled).toBe(true)
      expect(account?.name).toBe("Updated Account")
    })

    it("should throw when updating non-existent account", async () => {
      const manager = ConfigManager.getInstance({ configPath: testConfigPath })

      await expect(
        manager.updateAccount("non_existent", { enabled: true }),
      ).rejects.toThrow("Account non_existent not found")
    })

    it("should save config atomically", async () => {
      const manager = ConfigManager.getInstance({ configPath: testConfigPath })

      await manager.updateConfig({
        connect: { port: 9999, host: "test-host" },
      })

      // Verify file was written
      const content = await fs.readFile(testConfigPath, "utf-8")
      const parsed = JSON.parse(content)

      expect(parsed.connect.port).toBe(9999)
      expect(parsed.connect.host).toBe("test-host")
    })
  })

  describe("Environment variable overrides", () => {
    it("should override config with environment variables", async () => {
      process.env.PORT = "8080"
      process.env.HOST = "example.com"
      process.env.PLAID_ENVIRONMENT = "production"

      const manager = ConfigManager.getInstance({
        configPath: testConfigPath,
        enableEnvOverrides: true,
      })

      const config = await manager.getEffectiveConfig()

      expect(config.connect.port).toBe(8080)
      expect(config.connect.host).toBe("example.com")
      expect(config.plaid.environment).toBe("production")
    })

    it("should not apply env overrides when disabled", async () => {
      process.env.PORT = "8080"

      await fs.writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          connect: { port: 4456, host: "localhost" },
        }),
      )

      const manager = ConfigManager.getInstance({
        configPath: testConfigPath,
        enableEnvOverrides: false,
      })

      const config = await manager.getEffectiveConfig()

      expect(config.connect.port).toBe(4456)
    })

    it("should get service config with env overrides", async () => {
      process.env.PLAID_CLIENT_ID = "test-client-id"
      process.env.PLAID_SECRET = "test-secret"

      const manager = ConfigManager.getInstance({
        configPath: testConfigPath,
        enableEnvOverrides: true,
      })

      const plaidConfig = await manager.getServiceConfig("plaid")

      expect(plaidConfig.clientId).toBe("test-client-id")
      expect(plaidConfig.secret).toBe("test-secret")
    })
  })

  describe("Caching", () => {
    it("should cache config and reuse on subsequent calls", async () => {
      await fs.writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          connect: { port: 4456, host: "localhost" },
        }),
      )

      const manager = ConfigManager.getInstance({
        configPath: testConfigPath,
        cacheTtl: 10000,
      })

      const config1 = await manager.getConfig()
      const config2 = await manager.getConfig()

      // Should return same cached object
      expect(config1).toBe(config2)
    })

    it("should invalidate cache when file is modified", async () => {
      await fs.writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          connect: { port: 4456, host: "localhost" },
        }),
      )

      const manager = ConfigManager.getInstance({
        configPath: testConfigPath,
        cacheTtl: 10000,
      })

      // First load
      const config1 = await manager.getConfig()
      expect(config1.connect.port).toBe(4456)

      // Wait a bit to ensure different mtime
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Modify file
      await fs.writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          connect: { port: 8080, host: "localhost" },
        }),
      )

      // Second load should pick up changes
      const config2 = await manager.getConfig()
      expect(config2.connect.port).toBe(8080)
    })

    it("should reload config on demand", async () => {
      await fs.writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          connect: { port: 4456, host: "localhost" },
        }),
      )

      const manager = ConfigManager.getInstance({
        configPath: testConfigPath,
        cacheTtl: 10000,
      })

      const config1 = await manager.getConfig()
      expect(config1.connect.port).toBe(4456)

      // Modify file externally
      await fs.writeFile(
        testConfigPath,
        JSON.stringify({
          version: 1,
          connect: { port: 9999, host: "localhost" },
        }),
      )

      // Reload should pick up changes
      await manager.reloadConfig()
      const config2 = await manager.getConfig()

      expect(config2.connect.port).toBe(9999)
    })
  })

  describe("getServiceConfig", () => {
    it("should get connect service config", async () => {
      const manager = ConfigManager.getInstance({ configPath: testConfigPath })
      const connectConfig = await manager.getServiceConfig("connect")

      expect(connectConfig.port).toBe(4456)
      expect(connectConfig.host).toBe("localhost")
    })

    it("should get plaid service config", async () => {
      const manager = ConfigManager.getInstance({ configPath: testConfigPath })
      const plaidConfig = await manager.getServiceConfig("plaid")

      expect(plaidConfig.environment).toBe("sandbox")
    })

    it("should get gmail service config", async () => {
      const manager = ConfigManager.getInstance({ configPath: testConfigPath })
      const gmailConfig = await manager.getServiceConfig("gmail")

      expect(gmailConfig).toBeDefined()
    })
  })

  describe("Backward compatibility", () => {
    it("should load old config files without version field", async () => {
      const oldConfig = {
        // No version field
        plaid: { environment: "development" },
        accounts: [],
        webhooks: [],
      }

      await fs.writeFile(testConfigPath, JSON.stringify(oldConfig))

      const manager = ConfigManager.getInstance({ configPath: testConfigPath })
      const config = await manager.getConfig()

      // Should add default version and other fields
      expect(config.version).toBe(1)
      expect(config.plaid.environment).toBe("development")
      expect(config.connect).toBeDefined()
    })
  })
})

describe("env-loader", () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe("loadEnvOverrides", () => {
    it("should load all environment variable mappings", () => {
      // Clear all env vars first to ensure clean state
      delete process.env.PORT
      delete process.env.HOST
      delete process.env.PLAID_CLIENT_ID
      delete process.env.PLAID_SECRET
      delete process.env.PLAID_ENVIRONMENT
      delete process.env.FIRELA_RELAY_URL
      delete process.env.FIRELA_RELAY_API_KEY
      delete process.env.FIRELA_RELAY_TIMEOUT
      delete process.env.FIRELA_RELAY_MAX_RETRIES
      delete process.env.PUBLIC_URL
      delete process.env.TLS_ENABLED
      delete process.env.TLS_KEY_PATH
      delete process.env.TLS_CERT_PATH

      process.env.PORT = "3000"
      process.env.HOST = "example.com"
      process.env.PLAID_CLIENT_ID = "test-id"
      process.env.PLAID_SECRET = "test-secret"
      process.env.PLAID_ENVIRONMENT = "production"

      const overrides = loadEnvOverrides()

      expect(overrides).toEqual({
        connect: {
          port: 3000,
          host: "example.com",
        },
        plaid: {
          clientId: "test-id",
          secret: "test-secret",
          environment: "production",
        },
      })
    })

    it("should return empty object when no env vars set", () => {
      // Clear all BillClaw env vars
      delete process.env.PORT
      delete process.env.HOST
      delete process.env.PLAID_CLIENT_ID
      delete process.env.PLAID_SECRET
      delete process.env.PLAID_ENVIRONMENT
      delete process.env.FIRELA_RELAY_URL
      delete process.env.FIRELA_RELAY_API_KEY
      delete process.env.FIRELA_RELAY_TIMEOUT
      delete process.env.FIRELA_RELAY_MAX_RETRIES
      delete process.env.PUBLIC_URL
      delete process.env.TLS_ENABLED
      delete process.env.TLS_KEY_PATH
      delete process.env.TLS_CERT_PATH

      const overrides = loadEnvOverrides()

      expect(overrides).toEqual({})
    })

    it("should convert port string to number", () => {
      process.env.PORT = "8080"

      const overrides = loadEnvOverrides()

      expect(overrides.connect.port).toBe(8080)
      expect(typeof overrides.connect.port).toBe("number")
    })

    it("should convert boolean strings", () => {
      process.env.TEST_VAR = "true"
      process.env.TEST_VAR2 = "false"

      expect(getEnvValue("TEST_VAR")).toBe(true)
      expect(getEnvValue("TEST_VAR2")).toBe(false)
    })

    it("should convert number strings", () => {
      process.env.TEST_VAR = "42"

      expect(getEnvValue("TEST_VAR")).toBe(42)
    })
  })
})
