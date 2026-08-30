/**
 * Pair Landing Page (public, issue #34)
 *
 * Renders when /pair is opened with a valid `#code=<8-char>` fragment — the
 * shape produced by the dashboard "Copy pairing link" button and the
 * first-run bootstrap page. Tapping such a link in a phone browser would
 * otherwise hit the owner login gate, which rewrites the URL and drops the
 * fragment, leaving a non-owner (e.g. a family member the owner sent the
 * link to) at an unexplained dead end. This page carries no auth and makes
 * zero network calls: it renders only what the link itself carries (the
 * validated code plus this deployment's origin). The owner Pair page keeps
 * its invariant of never reading a code from its own URL.
 */
import { useState } from "react"
import { QrCode, Copy, Check } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { buildPairingUrl, groupClaimCode, copyToClipboard } from "@/lib/pairing"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function PairLandingPage({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const pairingUrl = buildPairingUrl(window.location.origin, code)

  const handleCopy = async () => {
    if (await copyToClipboard(pairingUrl)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold flex items-center justify-center gap-2">
            <QrCode className="size-6" /> Pair the firela app
          </h1>
          <p className="text-muted-foreground mt-1">
            This link pairs one device, once, within 10 minutes of creation.
          </p>
        </div>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            {/* White container keeps a dark-mode-safe quiet zone around the QR */}
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={pairingUrl} size={224} level="M" marginSize={4} />
            </div>
            <div className="select-all font-mono text-3xl font-bold tracking-widest">
              {groupClaimCode(code)}
            </div>
            <p className="text-center text-sm text-muted-foreground">
              On this phone: copy the link, then open the firela app &rarr;
              Settings &rarr; Connect billclaw &rarr; Paste pairing link. Or
              scan the QR from another device.
            </p>
            <Button onClick={handleCopy} className="w-full">
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy pairing link"}
            </Button>
            <p className="select-all break-all text-xs text-muted-foreground">
              {pairingUrl}
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          billclaw at {window.location.origin} — verify this matches what the
          person who sent you the link expects.
        </p>
      </div>
    </div>
  )
}
