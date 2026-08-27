/**
 * Webhooks Page
 *
 * Webhook configuration page for connection mode, public URL, and verification settings.
 */
import { useEffect, useState } from "react"
import { toast, Toaster } from "sonner"
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Webhook,
  Link,
  Activity,
  Shield,
  Radio,
  Clock,
  Play,
} from "lucide-react"
import { useConfigStore } from "@/stores/configStore"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { WebhookResultResponse } from "@/types/api"
import { apiFetch } from "@/lib/auth"

type ConnectionMode = "auto" | "direct" | "polling"

interface WebhookFormData {
  mode: ConnectionMode
  publicUrl: string
  healthCheckEnabled: boolean
  healthCheckTimeout: number
}

interface TestResult {
  success: boolean
  message: string
}

// Connection mode descriptions
const MODE_DESCRIPTIONS: Record<ConnectionMode, { title: string; description: string; icon: React.ReactNode }> = {
  auto: {
    title: "Auto",
    description: "Automatically select best available mode (Direct > Polling)",
    icon: <Radio className="w-5 h-5" />,
  },
  direct: {
    title: "Direct",
    description: "Receive webhooks directly. Best performance, requires public URL",
    icon: <Link className="w-5 h-5" />,
  },
  polling: {
    title: "Polling",
    description: "Periodically check for updates. Fallback when webhooks unavailable",
    icon: <Clock className="w-5 h-5" />,
  },
}

export function WebhooksPage() {
  const { config, loading, error, loadConfig, updateConfig } = useConfigStore()
  const [formData, setFormData] = useState<WebhookFormData>({
    mode: "auto",
    publicUrl: "",
    healthCheckEnabled: true,
    healthCheckTimeout: 5000,
  })
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Initialize form data from config
  useEffect(() => {
    if (config?.connect) {
      setFormData({
        mode: config.connect.connection?.mode || "auto",
        publicUrl: config.connect.publicUrl || "",
        healthCheckEnabled: config.connect.connection?.healthCheck?.enabled ?? true,
        healthCheckTimeout: config.connect.connection?.healthCheck?.timeout || 5000,
      })
    }
  }, [config])

  // Update form field
  const updateField = <K extends keyof WebhookFormData>(
    field: K,
    value: WebhookFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setTestResult(null)
  }

  // Test webhook configuration
  const handleTest = async () => {
    try {
      setTesting(true)
      setTestResult(null)

      const response = await apiFetch("/api/webhooks/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      const result: WebhookResultResponse = await response.json()

      if (result.success) {
        toast.success(result.message || "Test successful")
        setTestResult({ success: true, message: result.message || "Test successful" })
      } else {
        toast.error(result.error || "Test failed")
        setTestResult({ success: false, message: result.error || "Test failed" })
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to test configuration"
      toast.error(message)
      setTestResult({ success: false, message })
    } finally {
      setTesting(false)
    }
  }

  // Save webhook settings
  const handleSave = async () => {
    try {
      setSaving(true)

      // Build connect config update. publicUrl is explicitly nulled (not
      // omitted) when not in direct mode — PUT /api/config deep-merges, so an
      // omitted key would keep the previous value.
      const connectUpdate = {
        publicUrl: formData.mode === "direct" ? formData.publicUrl : null,
        connection: {
          mode: formData.mode,
          healthCheck: {
            enabled: formData.healthCheckEnabled,
            timeout: formData.healthCheckTimeout,
          },
        },
      }

      await updateConfig({ connect: connectUpdate })
      toast.success("Webhook settings saved successfully")
      setTestResult({ success: true, message: "Settings saved" })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save settings"
      toast.error(message)
      setTestResult({ success: false, message })
    } finally {
      setSaving(false)
    }
  }

  // Check if public URL is required
  const requiresPublicUrl = formData.mode === "direct"

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Toaster position="top-right" />

      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Webhook className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold">Webhook Settings</h1>
            <p className="text-muted-foreground text-sm">
              Configure how BillClaw receives webhooks from external services
            </p>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && !config && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 text-muted-foreground py-8">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading configuration...</span>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Test result */}
      {testResult && (
        <Alert variant={testResult.success ? "default" : "destructive"}>
          {testResult.success ? (
            <CheckCircle className="w-4 h-4 text-green-600" />
          ) : (
            <XCircle className="w-4 h-4 text-red-600" />
          )}
          <AlertDescription>{testResult.message}</AlertDescription>
        </Alert>
      )}

      {/* Connection mode section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Connection Mode
          </CardTitle>
          <CardDescription>
            Choose how BillClaw connects to external services
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(Object.keys(MODE_DESCRIPTIONS) as ConnectionMode[]).map((mode) => (
              <label
                key={mode}
                className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                  formData.mode === mode
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50"
                }`}
              >
                <input
                  type="radio"
                  name="connectionMode"
                  value={mode}
                  checked={formData.mode === mode}
                  onChange={() => updateField("mode", mode)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {MODE_DESCRIPTIONS[mode].icon}
                    </span>
                    <span className="font-medium">
                      {MODE_DESCRIPTIONS[mode].title}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {MODE_DESCRIPTIONS[mode].description}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Public URL section (for direct mode) */}
      {requiresPublicUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link className="w-5 h-5" />
              Public URL
            </CardTitle>
            <CardDescription>
              Required for Direct mode. Enter the public URL where your Connect
              service is accessible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="publicUrl">Public URL</Label>
              <Input
                type="url"
                id="publicUrl"
                value={formData.publicUrl}
                onChange={(e) => updateField("publicUrl", e.target.value)}
                placeholder="https://billclaw.yourdomain.com"
                required={requiresPublicUrl}
              />
              <p className="text-xs text-muted-foreground">
                Example: https://billclaw-ui.your-subdomain.workers.dev
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Health check section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Health Check
          </CardTitle>
          <CardDescription>
            Configure connection health monitoring settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="healthCheckEnabled"
              checked={formData.healthCheckEnabled}
              onCheckedChange={(checked) => updateField("healthCheckEnabled", checked === true)}
            />
            <Label htmlFor="healthCheckEnabled" className="cursor-pointer">
              Enable health checks for connection mode
            </Label>
          </div>

          {formData.healthCheckEnabled && (
            <div className="space-y-2">
              <Label htmlFor="healthCheckTimeout">Timeout (ms)</Label>
              <Input
                type="number"
                id="healthCheckTimeout"
                value={formData.healthCheckTimeout}
                onChange={(e) =>
                  updateField("healthCheckTimeout", parseInt(e.target.value) || 5000)
                }
                min={1000}
                max={30000}
                step={1000}
              />
              <p className="text-xs text-muted-foreground">
                Maximum time to wait for health check response (1000-30000 ms)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save and Test buttons */}
      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={saving || loading || (requiresPublicUrl && !formData.publicUrl)}
        >
          {saving && <RefreshCw className="w-4 h-4 animate-spin mr-2" />}
          Save Settings
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleTest}
          disabled={testing || loading || (requiresPublicUrl && !formData.publicUrl)}
        >
          {testing ? (
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          Test Configuration
        </Button>
      </div>
    </div>
  )
}
