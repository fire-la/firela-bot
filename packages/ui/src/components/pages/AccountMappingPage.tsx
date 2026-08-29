/**
 * Bank Mapping Page (issue #18 Tier 0, ADR-0113 P1)
 *
 * Open Banking connect flow: shows the external accounts discovered from the
 * connected Plaid items (credentials stay server-side), lets the owner map
 * each one to a vlt BeanAccount, and writes the opaque link to vlt. After a
 * mapping exists, sync lands transactions on the mapped account (vlt resolves
 * per-transaction account_id via the link table).
 */
import { useEffect, useState } from "react"
import { toast, Toaster } from "sonner"
import {
  ArrowLeftRight,
  AlertCircle,
  Loader2,
  Link2,
  RefreshCw,
  Unlink,
  TriangleAlert,
} from "lucide-react"
import {
  listDiscoveredAccounts,
  listBeanAccounts,
  listLinks,
  createLink,
  deleteLink,
  remapLink,
  VltNotConfiguredError,
  type DiscoveredAccount,
  type ItemDiscoveryError,
  type BeanAccountView,
  type LinkView,
} from "@/lib/account-mapping"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

/** Per-row selection state: externalAccountId -> chosen beanAccountId. */
type Selection = Record<string, string>

export function AccountMappingPage() {
  const [discovered, setDiscovered] = useState<DiscoveredAccount[]>([])
  const [discoverErrors, setDiscoverErrors] = useState<ItemDiscoveryError[]>([])
  const [beanAccounts, setBeanAccounts] = useState<BeanAccountView[]>([])
  const [links, setLinks] = useState<LinkView[]>([])
  const [loading, setLoading] = useState(true)
  const [vltNotConfigured, setVltNotConfigured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>({})
  const [changing, setChanging] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    setVltNotConfigured(false)
    try {
      const [discovery, accounts, linkList] = await Promise.all([
        listDiscoveredAccounts(),
        listBeanAccounts(),
        listLinks(),
      ])
      setDiscovered(discovery.accounts)
      setDiscoverErrors(discovery.errors)
      setBeanAccounts(accounts)
      setLinks(linkList)
    } catch (err) {
      if (err instanceof VltNotConfiguredError) {
        setVltNotConfigured(true)
      } else {
        setError(err instanceof Error ? err.message : "Failed to load mappings")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const reloadLinks = async () => {
    try {
      setLinks(await listLinks())
    } catch {
      // Non-fatal: the next full reload surfaces it.
    }
  }

  /** Active link per external account (vlt returns only active links). */
  const linkByExternal = new Map(links.map((l) => [l.externalAccountId, l]))
  const beanById = new Map(beanAccounts.map((a) => [a.id, a]))

  const handleLink = async (account: DiscoveredAccount) => {
    const beanAccountId = selection[account.externalAccountId]
    if (!beanAccountId) {
      toast.error("Choose a BeanAccount first")
      return
    }
    setBusy(account.externalAccountId)
    try {
      await createLink(account.externalAccountId, beanAccountId)
      toast.success(`Mapped "${account.name}"`)
      await reloadLinks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create link")
      // A link created elsewhere (or a stale view) can 422 — re-sync the truth.
      await reloadLinks()
    } finally {
      setBusy(null)
    }
  }

  const handleRemap = async (account: DiscoveredAccount, link: LinkView) => {
    const beanAccountId = selection[account.externalAccountId]
    if (!beanAccountId) {
      toast.error("Choose a BeanAccount first")
      return
    }
    setBusy(account.externalAccountId)
    try {
      await remapLink(link.id, account.externalAccountId, beanAccountId)
      toast.success(`Remapped "${account.name}"`)
      await reloadLinks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remap")
      // The DELETE may have succeeded before the POST failed — reflect the
      // now-unlinked truth instead of showing a stale mapping.
      await reloadLinks()
    } finally {
      setBusy(null)
      setChanging(null)
    }
  }

  const handleUnlink = async (account: DiscoveredAccount, link: LinkView) => {
    setBusy(account.externalAccountId)
    try {
      await deleteLink(link.id)
      toast.success(`Unmapped "${account.name}"`)
      await reloadLinks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unlink")
      await reloadLinks()
    } finally {
      setBusy(null)
    }
  }

  const sortedBeanAccounts = [...beanAccounts].sort((a, b) =>
    a.path.localeCompare(b.path),
  )

  const renderMappingColumn = (account: DiscoveredAccount) => {
    const link = linkByExternal.get(account.externalAccountId)
    const busyRow = busy === account.externalAccountId
    const changingRow = changing === account.externalAccountId

    if (link && !changingRow) {
      const bean = beanById.get(link.beanAccountId)
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {bean ? (
            <Badge variant="secondary" className="font-mono">
              {bean.path}
            </Badge>
          ) : (
            <Badge variant="destructive" className="font-mono">
              <TriangleAlert className="size-3" /> {link.beanAccountId.slice(0, 8)}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busyRow}
            onClick={() => setChanging(account.externalAccountId)}
          >
            Change
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busyRow}
            onClick={() => handleUnlink(account, link)}
          >
            {busyRow ? <Loader2 className="animate-spin" /> : <Unlink />} Unlink
          </Button>
        </div>
      )
    }

    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select
          value={selection[account.externalAccountId] ?? ""}
          onValueChange={(value) =>
            setSelection((prev) => ({
              ...prev,
              [account.externalAccountId]: value,
            }))
          }
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Choose a BeanAccount" />
          </SelectTrigger>
          <SelectContent>
            {sortedBeanAccounts.map((bean) => (
              <SelectItem key={bean.id} value={bean.id}>
                <span className="font-mono">{bean.path}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {link ? (
          <Button
            size="sm"
            disabled={busyRow}
            onClick={() => handleRemap(account, link)}
          >
            {busyRow ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />} Save
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busyRow}
            onClick={() => handleLink(account)}
          >
            {busyRow ? <Loader2 className="animate-spin" /> : <Link2 />} Link
          </Button>
        )}
        {changingRow && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busyRow}
            onClick={() => setChanging(null)}
          >
            Cancel
          </Button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Bank Mapping</h1>
        <p className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading mappings...
        </p>
      </div>
    )
  }

  if (vltNotConfigured) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Bank Mapping</h1>
        <Alert>
          <AlertCircle className="size-4" />
          <AlertDescription>
            Firela VLT is not configured. Mappings are stored in VLT — set it up
            on the{" "}
            <a className="underline" href="/vlt">
              VLT Integration
            </a>{" "}
            page first.
          </AlertDescription>
        </Alert>
        <Toaster position="top-right" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Bank Mapping</h1>
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={loadAll}>
          <RefreshCw /> Retry
        </Button>
        <Toaster position="top-right" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ArrowLeftRight className="size-6" /> Bank Mapping
        </h1>
        <p className="text-muted-foreground mt-1">
          Map each discovered bank account to a BeanAccount. Mapped accounts
          receive their own transactions on sync (vlt resolves per-account);
          unmapped ones fall back to the sync source account.
        </p>
      </div>

      {discoverErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            <div>Some banks could not be reached:</div>
            <ul className="mt-1 list-disc pl-4">
              {discoverErrors.map((e) => (
                <li key={e.itemId}>
                  {e.itemName ?? e.itemId}: {e.error}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {discovered.length === 0 ? (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertDescription>
            No bank accounts discovered. Connect a Plaid bank on the{" "}
            <a className="underline" href="/connect">
              Connect
            </a>{" "}
            page first.
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {discovered.map((account) => (
              <div
                key={`${account.itemId}:${account.externalAccountId}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">
                      {account.name}
                      {account.mask ? ` ••${account.mask}` : ""}
                    </span>
                    <Badge variant="outline">{account.itemName}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {[account.subtype ?? account.type, account.currency]
                      .filter(Boolean)
                      .join(" · ")}
                    {account.currentBalance != null &&
                      ` · balance ${account.currentBalance}`}
                  </div>
                </div>
                {renderMappingColumn(account)}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        Links live in Firela VLT (region-scoped). Remapping is delete + create;
        unlinking keeps historical transactions.
      </p>

      <Toaster position="top-right" />
    </div>
  )
}
