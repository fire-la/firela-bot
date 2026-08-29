/**
 * Settings Page
 *
 * Service toggle configuration page for BillClaw and Firela-Bot.
 * Users can enable/disable services at runtime.
 */
import { useEffect, useState } from "react"
import { toast, Toaster } from "sonner"
import { Settings, RefreshCw, AlertCircle, CheckCircle, Loader2, Radio, Database, Save, Eye, EyeOff, KeyRound, ArrowUpCircle, Trash2 } from "lucide-react"
import { SERVICE_CONFIGS, type ServiceState, type ServiceId, type ServicesApiResponse } from "@/types/services"
import { apiFetch, clearToken } from "@/lib/auth"
import { useRelayStore } from "@/stores/relayStore"
import { createAdapter } from "@/adapters"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function SettingsPage() {
  const [serviceState, setServiceState] = useState<ServiceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<ServiceId | null>(null)
  const { health: relayHealth, loading: relayLoading, loadHealth: loadRelayHealth } = useRelayStore()
  const [cacheInfo, setCacheInfo] = useState<{
    entries: number
    keys: string[]
    estimatedSize: string
  } | null>(null)
  const [clearing, setClearing] = useState(false)
  const [relayApiKeyInput, setRelayApiKeyInput] = useState("")
  const [relaySaving, setRelaySaving] = useState(false)
  const [showRelayKey, setShowRelayKey] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [changingPassword, setChangingPassword] = useState(false)

  // Cloudflare upgrade/uninstall state
  const [cfVersion, setCfVersion] = useState<{ current: string; latest: string | null } | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [cfApiTokenInput, setCfApiTokenInput] = useState("")
  const [cfTokenSaving, setCfTokenSaving] = useState(false)
  const [cfTokenConfigured, setCfTokenConfigured] = useState(false)
  const [cfTokenSource, setCfTokenSource] = useState<string | null>(null)
  const [showCfToken, setShowCfToken] = useState(false)
  const [uninstallState, setUninstallState] = useState<{
    phase: "idle" | "enumerating" | "confirming" | "deleting" | "done"
    resources?: { workers: any[]; databases: any[]; kvNamespaces: any[] }
    accountId?: string
    results?: Array<{ resource: string; type: string; success: boolean; error?: string }>
  }>({ phase: "idle" })

  // Load service state on mount
  useEffect(() => {
    loadServiceState()
  }, [])

  // Load relay health on mount
  useEffect(() => {
    loadRelayHealth()
  }, [loadRelayHealth])

  // Load cache stats on mount
  const loadCacheStats = async () => {
    try {
      const adapter = createAdapter()
      const stats = await adapter.getCacheStats()
      setCacheInfo(stats)
    } catch {
      // Silently fail -- cache stats are non-critical
    }
  }

  useEffect(() => {
    loadCacheStats()
  }, [])

  // Load Cloudflare version info on mount
  useEffect(() => {
    apiFetch("/api/cloudflare/version")
      .then((r) => r.json())
      .then((json: any) => json.success && setCfVersion(json.data))
      .catch(() => {}) // silently fail -- buttons still work
  }, [])

  // Load Cloudflare API token status on mount
  useEffect(() => {
    apiFetch("/api/settings/cloudflare")
      .then((r) => r.json())
      .then((json: any) => {
        if (json.success) {
          setCfTokenConfigured(json.data.configured)
          setCfTokenSource(json.data.source)
        }
      })
      .catch(() => {})
  }, [])

  const handleClearCache = async () => {
    setClearing(true)
    try {
      const adapter = createAdapter()
      const result = await adapter.clearCache()
      if (result.success) {
        toast.success("Cache cleared successfully")
        await loadCacheStats()
      } else {
        toast.error(result.error || "Failed to clear cache")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clear cache")
    } finally {
      setClearing(false)
    }
  }

  const loadServiceState = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/services")
      const json: ServicesApiResponse = await res.json()
      if (json.success && json.data) {
        setServiceState(json.data)
      } else {
        setError(json.error || "Failed to load service state")
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (serviceId: ServiceId, currentValue: boolean) => {
    setToggling(serviceId)
    try {
      const res = await apiFetch(`/api/services/${serviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentValue }),
      })
      const json: ServicesApiResponse = await res.json()
      if (json.success && json.data) {
        setServiceState(json.data)
        toast.success(`${serviceId === "billclaw" ? "BillClaw" : "Firela Bot"} ${!currentValue ? "enabled" : "disabled"}`)
      } else {
        toast.error(json.error || "Failed to update service")
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      toast.error(message)
    } finally {
      setToggling(null)
    }
  }

  const getServiceConfig = (serviceId: ServiceId) => {
    return SERVICE_CONFIGS.find((c) => c.id === serviceId)
  }

  const handleSaveRelayKey = async () => {
    if (!relayApiKeyInput.trim()) return
    setRelaySaving(true)
    try {
      const res = await apiFetch("/api/settings/relay", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: relayApiKeyInput.trim() }),
      })
      const json = await res.json() as { success?: boolean; error?: string }
      if (json.success) {
        toast.success("Relay API key saved")
        setRelayApiKeyInput("")
        loadRelayHealth()
      } else {
        toast.error(json.error || "Failed to save relay API key")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save relay API key")
    } finally {
      setRelaySaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) return
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match")
      return
    }
    setChangingPassword(true)
    try {
      const res = await apiFetch("/api/settings/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const json = await res.json() as { success?: boolean; error?: string }
      if (json.success) {
        toast.success("Password changed successfully")
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
      } else {
        toast.error(json.error || "Failed to change password")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password")
    } finally {
      setChangingPassword(false)
    }
  }

  const handleSaveCfToken = async () => {
    if (!cfApiTokenInput.trim()) return
    setCfTokenSaving(true)
    try {
      const res = await apiFetch("/api/settings/cloudflare", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: cfApiTokenInput.trim() }),
      })
      const json = await res.json() as { success?: boolean; error?: string }
      if (json.success) {
        toast.success("Cloudflare API token saved")
        setCfApiTokenInput("")
        setCfTokenConfigured(true)
        setCfTokenSource("kv")
      } else {
        toast.error(json.error || "Failed to save token")
      }
    } catch {
      toast.error("Failed to save token -- network error")
    } finally {
      setCfTokenSaving(false)
    }
  }

  const handleUpgrade = async () => {
    setUpgrading(true)
    try {
      const res = await apiFetch("/api/cloudflare/upgrade", { method: "POST" })
      const json = await res.json() as { success?: boolean; data?: { version: string }; error?: string }
      if (json.success) {
        toast.success(`Upgraded to ${json.data!.version}`)
        // Refresh version info
        const versionRes = await apiFetch("/api/cloudflare/version")
        const versionJson = await versionRes.json() as { success?: boolean; data?: { current: string; latest: string | null } }
        if (versionJson.success) setCfVersion(versionJson.data!)
      } else {
        toast.error(json.error || "Upgrade failed")
      }
    } catch {
      toast.error("Upgrade failed -- network error")
    } finally {
      setUpgrading(false)
    }
  }

  const handleUninstallClick = async () => {
    setUninstallState((prev) => ({ ...prev, phase: "enumerating" }))
    try {
      const res = await apiFetch("/api/cloudflare/uninstall/enumerate", { method: "POST" })
      const json = await res.json() as { success?: boolean; data?: { resources: any; accountId: string }; error?: string }
      if (json.success) {
        setUninstallState((prev) => ({
          ...prev,
          phase: "confirming",
          resources: json.data!.resources,
          accountId: json.data!.accountId,
        }))
      } else {
        toast.error(json.error || "Failed to enumerate resources")
        setUninstallState({ phase: "idle" })
      }
    } catch {
      toast.error("Failed to enumerate resources -- network error")
      setUninstallState({ phase: "idle" })
    }
  }

  const handleUninstallConfirm = async () => {
    setUninstallState((prev) => ({ ...prev, phase: "deleting" }))
    try {
      const res = await apiFetch("/api/cloudflare/uninstall/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workers: uninstallState.resources?.workers?.map((w: any) => w.id),
          databases: uninstallState.resources?.databases?.map((d: any) => d.id),
          kvNamespaces: uninstallState.resources?.kvNamespaces?.map((k: any) => k.id),
        }),
      })
      const json = await res.json() as { success?: boolean; data?: { results: Array<{ resource: string; type: string; success: boolean; error?: string }> }; error?: string }
      if (json.success) {
        const succeeded = json.data!.results.filter((r) => r.success).length
        const total = json.data!.results.length
        setUninstallState((prev) => ({ ...prev, phase: "done", results: json.data!.results }))
        clearToken()
        toast.success(`Uninstalled: ${succeeded}/${total} resources deleted`)
      } else {
        toast.error(json.error || "Uninstall failed")
        setUninstallState({ phase: "idle" })
      }
    } catch {
      toast.error("Uninstall failed -- network error (Worker may have been deleted)")
      clearToken()
      setUninstallState({ phase: "idle" })
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Toaster position="top-right" />

      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6" />
          Service Settings
        </h1>
        <p className="text-muted-foreground text-sm">
          Enable or disable services at runtime
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 text-muted-foreground py-8">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading service settings...</span>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription className="flex items-center justify-between w-full">
            {error}
            <Button
              variant="ghost"
              size="sm"
              onClick={loadServiceState}
              className="ml-4"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Service toggles */}
      {!loading && serviceState && (
        <div className="space-y-4">
          {(Object.keys(serviceState) as ServiceId[]).map((serviceId) => {
            const config = getServiceConfig(serviceId)
            const isEnabled = serviceState[serviceId]
            const isToggling = toggling === serviceId
            const isDisabled = !!config?.disabledReason

            return (
              <Card key={serviceId}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-2xl">
                      {config?.id === "billclaw" ? "💰" : "🤖"}
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-semibold">
                        {config?.name || serviceId}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {config?.description || "Service configuration"}
                      </p>
                      {isDisabled ? (
                        <p className="text-sm text-amber-600">{config.disabledReason}</p>
                      ) : (
                      <div className="flex items-center gap-2">
                        {isEnabled ? (
                          <>
                            <CheckCircle className="w-4 h-4 text-green-500" />
                            <span className="text-sm text-green-600">Enabled</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Disabled</span>
                          </>
                        )}
                      </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={isEnabled}
                      onCheckedChange={() => handleToggle(serviceId, isEnabled)}
                      disabled={isToggling || isDisabled}
                    />
                    {isToggling && (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Relay Service status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="w-5 h-5" />
            Relay Service
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {relayLoading && !relayHealth && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading relay status...</span>
            </div>
          )}

          {relayHealth && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm">Configured</span>
                <Badge variant={relayHealth.configured ? "default" : "secondary"}>
                  {relayHealth.configured ? "Yes" : "No"}
                </Badge>
              </div>

              {relayHealth.configured && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Status</span>
                    <Badge variant={relayHealth.available ? "default" : "destructive"}>
                      {relayHealth.available ? "Connected" : "Unavailable"}
                    </Badge>
                  </div>

                  {relayHealth.latency !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Latency</span>
                      <span className="text-sm text-muted-foreground">{relayHealth.latency}ms</span>
                    </div>
                  )}

                  {relayHealth.apiKeyMasked && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm">API Key</span>
                      <span className="text-sm font-mono text-muted-foreground">{relayHealth.apiKeyMasked}</span>
                    </div>
                  )}

                  {relayHealth.relayUrl && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Relay URL</span>
                      <span className="text-sm text-muted-foreground">{relayHealth.relayUrl}</span>
                    </div>
                  )}
                </>
              )}

              {relayHealth.error && (
                <p className="text-sm text-destructive">{relayHealth.error}</p>
              )}

              {relayHealth.lastChecked && (
                <div className="text-xs text-muted-foreground pt-1">
                  Last checked: {new Date(relayHealth.lastChecked).toLocaleString()}
                </div>
              )}
            </>
          )}

          {/* Relay API Key input */}
          <div className="space-y-2 pt-2 border-t">
            <label className="text-sm font-medium">
              {relayHealth?.configured ? "Update Relay API Key" : "Set Relay API Key"}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showRelayKey ? "text" : "password"}
                  placeholder={relayHealth?.configured ? "Enter new key to update" : "Enter your relay API key"}
                  value={relayApiKeyInput}
                  onChange={(e) => setRelayApiKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveRelayKey()}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowRelayKey(!showRelayKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showRelayKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                size="sm"
                onClick={handleSaveRelayKey}
                disabled={!relayApiKeyInput.trim() || relaySaving}
              >
                {relaySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={loadRelayHealth}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Password Change */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <Button
            size="sm"
            onClick={handleChangePassword}
            disabled={!currentPassword || !newPassword || !confirmPassword || changingPassword}
          >
            {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Update Password
          </Button>
        </CardContent>
      </Card>

      {/* Cache Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Cache
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {cacheInfo && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm">Entries</span>
                <span className="text-sm text-muted-foreground">
                  {cacheInfo.entries} entries, ~{cacheInfo.estimatedSize}
                </span>
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearCache}
              disabled={clearing}
            >
              {clearing && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Clear Cache
            </Button>
            <Button variant="ghost" size="sm" onClick={loadCacheStats}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cloudflare Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpCircle className="w-5 h-5" />
            Cloudflare Deployment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Version display */}
          {cfVersion && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm">Current version</span>
                <span className="text-sm text-muted-foreground">{cfVersion.current}</span>
              </div>
              {cfVersion.latest && cfVersion.latest !== cfVersion.current && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Latest version</span>
                  <Badge variant="secondary">{cfVersion.latest}</Badge>
                </div>
              )}
            </div>
          )}

          {/* Cloudflare API token configuration */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">API Token</span>
              {cfTokenConfigured && (
                <Badge variant="secondary" className="text-xs">
                  {cfTokenSource === "env" ? "via env" : "configured"}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showCfToken ? "text" : "password"}
                  placeholder={cfTokenConfigured ? "Enter new token to update" : "Enter your Cloudflare API token"}
                  value={cfApiTokenInput}
                  onChange={(e) => setCfApiTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveCfToken()}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCfToken(!showCfToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCfToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                size="sm"
                onClick={handleSaveCfToken}
                disabled={!cfApiTokenInput.trim() || cfTokenSaving}
              >
                {cfTokenSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save
              </Button>
            </div>
            {!cfTokenConfigured && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Required for Uninstall. Create a token with these permissions:</p>
                <ul className="list-disc ml-4 space-y-0.5">
                  <li>Workers Scripts: Edit</li>
                  <li>D1: Edit</li>
                  <li>Workers KV Storage: Edit</li>
                </ul>
                <a
                  href="https://dash.cloudflare.com/profile/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Create API Token &rarr;
                </a>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleUpgrade}
              disabled={upgrading}
            >
              {upgrading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
              Upgrade
            </Button>
            <Button
              size="sm"
              onClick={handleUninstallClick}
              disabled={uninstallState.phase !== "idle"}
            >
              {uninstallState.phase === "enumerating" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Uninstall
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Uninstall Confirmation Dialog */}
      <AlertDialog
        open={uninstallState.phase === "confirming" || uninstallState.phase === "deleting" || uninstallState.phase === "done"}
        onOpenChange={(open) => {
          if (!open) setUninstallState({ phase: "idle" })
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall Firela Connect</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                {/* Resource list */}
                {uninstallState.resources && (
                  <div className="space-y-2">
                    {uninstallState.resources.workers.length > 0 && (
                      <div>
                        <p className="font-medium text-sm">Workers:</p>
                        <ul className="text-sm text-muted-foreground ml-4 list-disc">
                          {uninstallState.resources.workers.map((w: any) => (
                            <li key={w.id}>{w.id}{w.title ? ` (${w.title})` : ""}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {uninstallState.resources.databases.length > 0 && (
                      <div>
                        <p className="font-medium text-sm">D1 Databases:</p>
                        <ul className="text-sm text-muted-foreground ml-4 list-disc">
                          {uninstallState.resources.databases.map((d: any) => (
                            <li key={d.id}>{d.name} ({d.id})</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {uninstallState.resources.kvNamespaces.length > 0 && (
                      <div>
                        <p className="font-medium text-sm">KV Namespaces:</p>
                        <ul className="text-sm text-muted-foreground ml-4 list-disc">
                          {uninstallState.resources.kvNamespaces.map((k: any) => (
                            <li key={k.id}>{k.title} ({k.id})</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Results summary after deletion */}
                {uninstallState.phase === "done" && uninstallState.results && (
                  <div className="space-y-1">
                    <p className="font-medium text-sm">Results:</p>
                    <ul className="text-sm ml-4 list-disc">
                      {uninstallState.results.map((r, i) => (
                        <li key={i} className={r.success ? "text-green-600" : "text-destructive"}>
                          {r.type}: {r.resource} -- {r.success ? "deleted" : r.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Warning */}
                {uninstallState.phase !== "done" && (
                  <p className="text-sm text-destructive">
                    This will permanently delete all listed Cloudflare resources. The running Worker will be deleted last.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setUninstallState({ phase: "idle" })}>
              {uninstallState.phase === "done" ? "Close" : "Cancel"}
            </AlertDialogCancel>
            {uninstallState.phase !== "done" && (
              <AlertDialogAction
                onClick={handleUninstallConfirm}
                disabled={uninstallState.phase === "deleting"}
              >
                {uninstallState.phase === "deleting" && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete All
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Info section */}
      {!loading && serviceState && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">About Service Toggles</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>• Disabled services will return 503 (Service Unavailable) for their routes</li>
              <li>• Changes take effect immediately</li>
              <li>• Service state is persisted in KV store</li>
              <li>• Default values can be set via environment variables</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
