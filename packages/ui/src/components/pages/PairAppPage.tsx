/**
 * Pair App Page
 *
 * Issues a one-time claim code via POST /api/pair/issue and renders it as
 * a QR pairing link + grouped readable code + Worker URL for the mobile
 * app to scan or paste. The claim code only ever appears in the
 * client-rendered QR/link string (URL fragment) — never in a
 * network-fetched URL; this page never reads a code from its own URL.
 */
import { useEffect, useState } from "react"
import { toast, Toaster } from "sonner"
import { QrCode, Copy, RefreshCw, AlertCircle, Loader2, Ban } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { apiFetch } from "@/lib/auth"
import {
  buildPairingUrl,
  groupClaimCode,
  formatCountdown,
  copyToClipboard,
  listPairedApps,
  revokeApp,
  type PairIssueResponse,
  type PairedApp,
} from "@/lib/pairing"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"

export function PairAppPage() {
  const [issue, setIssue] = useState<PairIssueResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [issuing, setIssuing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [apps, setApps] = useState<PairedApp[]>([])
  const [appsLoading, setAppsLoading] = useState(true)
  const [appsError, setAppsError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  // Issue a fresh claim code (owner Bearer attached by apiFetch).
  const issueCode = async () => {
    setIssuing(true)
    setError(null)
    try {
      const res = await apiFetch("/api/pair/issue", { method: "POST" })
      const json: PairIssueResponse & { error?: string } = await res.json()
      if (res.ok && json.success) {
        setIssue(json)
        setNow(Date.now())
      } else {
        setError(json.error || "Failed to issue a claim code")
        // Re-issue only runs from the expired state, so the held code is
        // already dead — drop it so the error UI (error && !issue) renders.
        setIssue(null)
      }
    } catch {
      setError("Failed to issue a claim code -- network error")
      setIssue(null)
    } finally {
      setLoading(false)
      setIssuing(false)
    }
  }

  useEffect(() => {
    issueCode()
  }, [])

  // Load the paired-devices list (owner Bearer attached by apiFetch).
  const loadApps = async () => {
    setAppsLoading(true)
    setAppsError(null)
    try {
      const json = await listPairedApps()
      if (json.success && json.apps) {
        setApps(json.apps)
      } else {
        setAppsError(json.error || "Failed to load paired devices")
      }
    } catch {
      setAppsError("Failed to load paired devices -- network error")
    } finally {
      setAppsLoading(false)
    }
  }

  useEffect(() => {
    loadApps()
  }, [])

  // One-tap revoke (issue #22): revocation is idempotent and immediately
  // visible in the list (Revoked badge), so no confirm dialog.
  const handleRevoke = async (appId: string) => {
    setRevoking(appId)
    try {
      const json = await revokeApp(appId)
      if (json.success) {
        toast.success("Device revoked")
        await loadApps()
      } else {
        toast.error(json.error || "Failed to revoke device")
      }
    } catch {
      toast.error("Failed to revoke device -- network error")
    } finally {
      setRevoking(null)
    }
  }

  const remainingMs = issue ? issue.expiresAt * 1000 - now : 0
  const expired = issue !== null && remainingMs <= 0

  // Recompute from the wall clock every tick (never decrement a counter —
  // background-tab throttling must not drift the countdown). Stops on expiry.
  useEffect(() => {
    if (!issue || expired) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [issue, expired])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  if (error && !issue) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Pair app</h1>
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={issueCode} disabled={issuing}>
          {issuing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry
        </Button>
        <Toaster position="top-right" />
      </div>
    )
  }

  if (!issue) return null

  const pairingUrl = buildPairingUrl(issue.workerUrl, issue.claimCode)

  const handleCopy = async () => {
    const ok = await copyToClipboard(pairingUrl)
    if (ok) {
      toast.success("Pairing link copied")
    } else {
      toast.error("Copy failed -- select the link text and copy manually")
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <QrCode className="size-6" /> Pair app
        </h1>
        <p className="text-muted-foreground mt-1">
          Scan the QR in the firela app, or paste the pairing link. The code is
          single-use.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6">
          {/* White container keeps a dark-mode-safe quiet zone around the QR */}
          <div
            className={
              expired
                ? "inline-flex rounded-lg bg-white p-4 opacity-30 grayscale"
                : "inline-flex rounded-lg bg-white p-4"
            }
          >
            <QRCodeSVG value={pairingUrl} size={256} level="M" marginSize={4} />
          </div>

          {expired ? (
            <p className="font-semibold text-destructive">Code expired</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Expires in {formatCountdown(remainingMs)} · approximate
            </p>
          )}

          <div className="font-mono text-3xl font-bold tracking-widest">
            {groupClaimCode(issue.claimCode)}
          </div>

          <div
            className="font-mono text-sm text-muted-foreground break-all select-all text-center"
            title={issue.workerUrl}
          >
            {issue.workerUrl}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={handleCopy} disabled={expired}>
              <Copy /> Copy pairing link
            </Button>
            {expired && (
              <Button onClick={issueCode} disabled={issuing}>
                {issuing ? <Loader2 className="animate-spin" /> : <RefreshCw />}{" "}
                Generate new code
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <h2 className="font-semibold">Paired devices</h2>

          {appsLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading paired devices...
            </p>
          ) : appsError ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{appsError}</AlertDescription>
            </Alert>
          ) : apps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No devices paired yet. Scan the QR code above to pair the firela
              app.
            </p>
          ) : (
            <div className="space-y-2">
              {apps.map((app) => (
                <div
                  key={app.appId}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={app.revoked ? "destructive" : "secondary"}
                      >
                        {app.revoked ? "Revoked" : "Active"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Paired {new Date(app.pairedAt * 1000).toLocaleString()}
                      </span>
                    </div>
                    <div
                      className="font-mono text-xs text-muted-foreground select-all mt-1"
                      title={app.appId}
                    >
                      {app.appId.slice(0, 8)}…
                    </div>
                  </div>
                  {!app.revoked && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      disabled={revoking === app.appId}
                      onClick={() => handleRevoke(app.appId)}
                    >
                      {revoking === app.appId ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Ban className="size-4" />
                      )}{" "}
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Toaster position="top-right" />
    </div>
  )
}
