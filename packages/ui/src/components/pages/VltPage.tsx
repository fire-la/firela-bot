/**
 * VLT Page
 *
 * VLT configuration page for Firela VLT Beancount SaaS integration settings.
 */
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast, Toaster } from "sonner"
import {
  Globe,
  Key,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
} from "lucide-react"
import { z } from "zod"
import { useConfigStore } from "@/stores/configStore"
import { createAdapter } from "@/adapters"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { ApiResultResponse } from "@/types/api"
import { apiFetch } from "@/lib/auth"

// Form schema for VLT settings
const VltSettingsSchema = z.object({
  apiUrl: z.string().url().default("https://vlt.firela.io/api/v1"),
  accessToken: z.string().optional(),
  region: z.enum(["cn", "us", "eu-core", "de"]).default("us"),
  uploadMode: z.enum(["disabled", "auto", "manual"]).default("disabled"),
  sourceAccount: z.string().optional(),
  defaultCurrency: z.string().default("USD"),
  defaultExpenseAccount: z.string().default("Expenses:Unknown"),
  defaultIncomeAccount: z.string().default("Income:Unknown"),
  filterPending: z.boolean().default(true),
})

type VltSettings = z.infer<typeof VltSettingsSchema>

export function VltPage() {
  const { config, loading, error, loadConfig, accounts } = useConfigStore()
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Initialize form with current config values
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    getValues,
    setValue,
    reset,
  } = useForm<VltSettings>({
    defaultValues: {
      apiUrl: config?.vlt?.apiUrl || "https://vlt.firela.io/api/v1",
      accessToken: config?.vlt?.accessToken || "",
      region: config?.vlt?.region || "us",
      uploadMode: config?.vlt?.upload?.mode || "disabled",
      sourceAccount: config?.vlt?.upload?.sourceAccount || "",
      defaultCurrency: config?.vlt?.upload?.defaultCurrency || "USD",
      defaultExpenseAccount: config?.vlt?.upload?.defaultExpenseAccount || "Expenses:Unknown",
      defaultIncomeAccount: config?.vlt?.upload?.defaultIncomeAccount || "Income:Unknown",
      filterPending: config?.vlt?.upload?.filterPending ?? true,
    },
  })

  // Re-initialize form when config loads
  useEffect(() => {
    if (config?.vlt) {
      reset({
        apiUrl: config.vlt.apiUrl || "https://vlt.firela.io/api/v1",
        accessToken: config.vlt.accessToken || "",
        region: config.vlt.region || "us",
        uploadMode: config.vlt.upload?.mode || "disabled",
        sourceAccount: config.vlt.upload?.sourceAccount || "",
        defaultCurrency: config.vlt.upload?.defaultCurrency || "USD",
        defaultExpenseAccount: config.vlt.upload?.defaultExpenseAccount || "Expenses:Unknown",
        defaultIncomeAccount: config.vlt.upload?.defaultIncomeAccount || "Income:Unknown",
        filterPending: config.vlt.upload?.filterPending ?? true,
      })
    }
  }, [config, reset])

  // Test VLT configuration
  const handleTest = async () => {
    try {
      setTesting(true)
      setTestResult(null)

      const response = await apiFetch("/api/vlt/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiUrl: getValues("apiUrl"),
          accessToken: getValues("accessToken"),
          region: getValues("region"),
        }),
      })

      if (!response.ok) {
        throw new Error(`Test failed: ${response.statusText}`)
      }

      const result: ApiResultResponse = await response.json()
      if (result.success) {
        setTestResult({ success: true, message: result.message || "Configuration valid" })
        toast.success("VLT configuration is valid")
      } else {
        setTestResult({
          success: false,
          message: result.error || "Validation failed",
        })
        toast.error(result.error || "Validation failed")
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

  // Save VLT settings
  const handleSave = async (data: VltSettings) => {
    try {
      setSaving(true)
      const adapter = createAdapter()

      // Transform form data to config structure
      const vltConfig = {
        apiUrl: data.apiUrl,
        accessToken: data.accessToken || undefined,
        region: data.region,
        upload: data.uploadMode !== "disabled" ? {
          mode: data.uploadMode as "auto" | "manual",
          sourceAccount: data.sourceAccount || "",
          defaultCurrency: data.defaultCurrency,
          defaultExpenseAccount: data.defaultExpenseAccount,
          defaultIncomeAccount: data.defaultIncomeAccount,
          filterPending: data.filterPending,
        } : undefined,
      }

      await adapter.updateConfig({ vlt: vltConfig })
      toast.success("VLT settings saved successfully")
      await loadConfig()
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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Toaster position="top-right" />

      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Firela VLT Integration</h1>
        <p className="text-muted-foreground text-sm">
          Configure Firela VLT Beancount SaaS upload settings
        </p>
      </div>

      {/* Loading state */}
      {loading && !testResult && (
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

      {/* VLT settings form */}
      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiUrl">API URL</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  type="url"
                  id="apiUrl"
                  {...register("apiUrl")}
                  placeholder="https://vlt.firela.io/api/v1"
                  className="pl-10"
                />
              </div>
              {errors.apiUrl && (
                <p className="text-sm text-destructive">{errors.apiUrl.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="accessToken">Access Token</Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  type="password"
                  id="accessToken"
                  {...register("accessToken")}
                  placeholder="Enter your access token"
                  className="pl-10"
                />
              </div>
              {errors.accessToken && (
                <p className="text-sm text-destructive">{errors.accessToken.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Region</Label>
              <select
                id="region"
                {...register("region")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring"
              >
                <option value="cn">China</option>
                <option value="us">United States</option>
                <option value="eu-core">EU Core</option>
                <option value="de">Germany</option>
              </select>
              {errors.region && (
                <p className="text-sm text-destructive">{errors.region.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <h3 className="text-lg font-semibold">Upload Settings</h3>

            <div className="space-y-2">
              <Label htmlFor="uploadMode">Upload Mode</Label>
              <select
                id="uploadMode"
                {...register("uploadMode")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring"
              >
                <option value="disabled">Disabled</option>
                <option value="auto">Automatic</option>
                <option value="manual">Manual</option>
              </select>
              {errors.uploadMode && (
                <p className="text-sm text-destructive">{errors.uploadMode.message}</p>
              )}
            </div>

            {watch("uploadMode") !== "disabled" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="sourceAccount">Source Account</Label>
                  <select
                    id="sourceAccount"
                    {...register("sourceAccount")}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring"
                  >
                    <option value="">Select an account</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                  {errors.sourceAccount && (
                    <p className="text-sm text-destructive">{errors.sourceAccount.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultCurrency">Default Currency</Label>
                  <Input
                    type="text"
                    id="defaultCurrency"
                    {...register("defaultCurrency")}
                    placeholder="USD"
                  />
                  {errors.defaultCurrency && (
                    <p className="text-sm text-destructive">{errors.defaultCurrency.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultExpenseAccount">Default Expense Account</Label>
                  <Input
                    type="text"
                    id="defaultExpenseAccount"
                    {...register("defaultExpenseAccount")}
                    placeholder="Expenses:Unknown"
                  />
                  {errors.defaultExpenseAccount && (
                    <p className="text-sm text-destructive">{errors.defaultExpenseAccount.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultIncomeAccount">Default Income Account</Label>
                  <Input
                    type="text"
                    id="defaultIncomeAccount"
                    {...register("defaultIncomeAccount")}
                    placeholder="Income:Unknown"
                  />
                  {errors.defaultIncomeAccount && (
                    <p className="text-sm text-destructive">{errors.defaultIncomeAccount.message}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="filterPending"
                    checked={watch("filterPending")}
                    onCheckedChange={(checked) => setValue("filterPending", checked === true)}
                  />
                  <Label htmlFor="filterPending" className="cursor-pointer">
                    Filter pending transactions
                  </Label>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Save and Test buttons */}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving || loading}>
            {(saving || loading) && <RefreshCw className="w-4 h-4 animate-spin mr-2" />}
            Save Settings
          </Button>
          <Button type="button" variant="outline" onClick={handleTest} disabled={testing || loading}>
            {testing ? (
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Test Configuration
          </Button>
        </div>
      </form>
    </div>
  )
}
