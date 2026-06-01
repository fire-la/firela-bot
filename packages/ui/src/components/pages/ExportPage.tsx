/**
 * Export Page
 *
 * Export configuration page for export format settings and output path configuration.
 */
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast, Toaster } from "sonner"
import {
  FolderOpen,
  Eye,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
  CreditCard,
  Mail,
  Landmark,
} from "lucide-react"
import { useConfigStore } from "@/stores/configStore"
import { createAdapter } from "@/adapters"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import type { ApiResultResponse } from "@/types/api"
import { apiFetch } from "@/lib/auth"

// Export config type
interface ExportConfig {
  format: "beancount" | "ledger"
  outputPath: string
  filePrefix: string
  includePending: boolean
  currencyColumn: boolean
}

// Sample Beancount transaction
const sampleBeancountTransaction = `2024-03-15 * "Coffee Shop"
  Expenses:Food:Coffee    $4.50
  Liabilities:Assets:Cash
`

// Sample Ledger transaction
const sampleLedgerTransaction = `2024-03-15 * Coffee Shop
  Expenses:Food:Coffee    $4.50
  ; Assets:Cash
`

export function ExportPage() {
  const { config, loading, error, loadConfig, accounts } = useConfigStore()
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())

  const [previewFormat, setPreviewFormat] = useState<"beancount" | "ledger">("beancount")

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Initialize form with current config values
  const {
    register,
    handleSubmit,
    formState: { errors: _errors },
    watch,
    setValue,
    getValues,
    reset,
  } = useForm<ExportConfig>({
    defaultValues: {
      format: config?.export?.format || "beancount",
      outputPath: config?.export?.outputPath || "~/.firela/billclaw/exports",
      filePrefix: config?.export?.filePrefix || "transactions",
      includePending: config?.export?.includePending || false,
      currencyColumn: config?.export?.currencyColumn || true,
    },
  })

  // Re-initialize form when config loads
  useEffect(() => {
    if (config?.export) {
      reset({
        format: config.export.format || "beancount",
        outputPath: config.export.outputPath || "~/.firela/billclaw/exports",
        filePrefix: config.export.filePrefix || "transactions",
        includePending: config.export.includePending || false,
        currencyColumn: config.export.currencyColumn || true,
      })
    }
  }, [config, reset])

  // Initialize selected accounts from saved config or default to all
  useEffect(() => {
    if (config?.export?.selectedAccounts) {
      setSelectedAccounts(new Set(config.export.selectedAccounts))
    } else if (accounts.length > 0 && selectedAccounts.size === 0) {
      setSelectedAccounts(new Set(accounts.map((a) => a.id)))
    }
  }, [config, accounts])

  // Get type icon for account
  const getTypeIcon = (type: string) => {
    switch (type) {
      case "plaid":
        return <CreditCard className="w-4 h-4" />
      case "gmail":
        return <Mail className="w-4 h-4" />
      case "gocardless":
        return <Landmark className="w-4 h-4" />
      default:
        return null
    }
  }

  // Update preview when format changes
  useEffect(() => {
    const subscription = watch((value: Partial<ExportConfig>, { name }: { name?: string }) => {
      if (name === "format" && value.format) {
        setPreviewFormat(value.format as "beancount" | "ledger")
      }
    })
    return () => subscription.unsubscribe()
  }, [watch])

  // Test export configuration
  const handleTest = async () => {
    try {
      setTesting(true)
      setTestResult(null)

      const response = await apiFetch("/api/export/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: getValues("format"),
          outputPath: getValues("outputPath"),
          filePrefix: getValues("filePrefix"),
        }),
      })

      if (!response.ok) {
        throw new Error(`Test failed: ${response.statusText}`)
      }

      const result: ApiResultResponse = await response.json()
      if (result.success) {
        setTestResult({ success: true, message: result.message || "Configuration valid" })
        toast.success("Export configuration is valid")
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

  // Save export settings
  const handleSave = async (data: ExportConfig) => {
    try {
      setSaving(true)
      const adapter = createAdapter()
      await adapter.updateConfig({
        export: {
          ...data,
          selectedAccounts: Array.from(selectedAccounts),
        },
      })
      toast.success("Export settings saved successfully")
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
        <h1 className="text-2xl font-bold">Export Settings</h1>
        <p className="text-muted-foreground text-sm">
          Configure Beancount or Ledger export format and output location
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
            <XCircle className="w-4 h-4" />
          )}
          <AlertDescription>{testResult.message}</AlertDescription>
        </Alert>
      )}

      {/* Export settings form */}
      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        {/* Account Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Account Selection</CardTitle>
            <CardDescription>Select accounts to include in export</CardDescription>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No accounts found.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {accounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <Checkbox
                      checked={selectedAccounts.has(account.id)}
                      onCheckedChange={() => {
                        setSelectedAccounts((prev) => {
                          const newSet = new Set(prev)
                          if (newSet.has(account.id)) newSet.delete(account.id)
                          else newSet.add(account.id)
                          return newSet
                        })
                      }}
                    />
                    {getTypeIcon(account.type)}
                    <span className="text-sm font-medium">{account.name}</span>
                    <Badge variant="secondary" className="ml-auto">{account.type}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Format Settings</CardTitle>
            <CardDescription>Choose your preferred export format</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="format">Export Format</Label>
              <select
                id="format"
                {...register("format")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring md:text-sm"
              >
                <option value="beancount">Beancount</option>
                <option value="ledger">Ledger</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="outputPath">Output Path</Label>
              <div className="relative">
                <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  type="text"
                  id="outputPath"
                  {...register("outputPath")}
                  className="pl-10"
                  placeholder="~/.firela/billclaw/exports"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filePrefix">File Prefix</Label>
              <Input
                type="text"
                id="filePrefix"
                {...register("filePrefix")}
                placeholder="transactions"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="includePending"
                checked={watch("includePending")}
                onCheckedChange={(checked) => setValue("includePending", checked === true)}
              />
              <Label htmlFor="includePending" className="font-normal cursor-pointer">
                Include pending transactions
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="currencyColumn"
                checked={watch("currencyColumn")}
                onCheckedChange={(checked) => setValue("currencyColumn", checked === true)}
              />
              <Label htmlFor="currencyColumn" className="font-normal cursor-pointer">
                Add currency column
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Preview section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
                <Eye className="w-5 h-5" />
                Output Preview ({previewFormat})
              </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-muted p-4 rounded-lg overflow-x-auto">
              {previewFormat === "beancount"
                ? sampleBeancountTransaction
                : sampleLedgerTransaction}
            </pre>
          </CardContent>
        </Card>

        {/* Save and Test buttons */}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving || loading}>
            {(saving || loading) && <RefreshCw className="w-4 h-4 animate-spin mr-2" />}
            Save Settings
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={testing || loading}
          >
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
