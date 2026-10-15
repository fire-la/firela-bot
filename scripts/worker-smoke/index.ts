/**
 * Workerd runtime smoke for the wasm parser crates (fire-la/firela-bot#44
 * AC1). Builds with wrangler (which resolves the crates' exports maps
 * through the worker condition to index-worker.js — static wasm imports),
 * then serves /smoke: registry detect + parse over two embedded fixtures.
 *
 * Fixtures are embedded base64 (ASCII-clean source; the raw CSVs carry
 * Chinese) from the vendored frozen copies at generation time.
 */

// Built dist (workspace dep not resolvable from a non-package dir; core is
// built before this smoke runs).
import { parserRegistry } from "../../packages/billclaw/core/dist/parsers/index.js"

const CN_FIXTURE_B64 = "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCueUqOaIt+S/oeaBr++8mgrlp5PlkI3vvJrmtYvor5XnlKjmiLcK5pSv5LuY5a6d6LSm5oi377yadGVzdEBleGFtcGxlLmNvbQrotbflp4vml7bpl7TvvJpbMjAyNC0wMS0wMSAwMDowMDowMF0gICAg57uI5q2i5pe26Ze077yaWzIwMjQtMDEtMzEgMjM6NTk6NTldCuWvvOWHuuexu+Wei++8mlvlhajpg6hdCuWvvOWHuuaXtumXtO+8mlsyMDI0LTAyLTAxIDEwOjMwOjAwXQrlhbExNeadoeiusOW9lQrmlLblhaXvvJoy56yUIDEwMC4wMOWFgwrmlK/lh7rvvJoxMOeslCA1MDAuMDDlhYMK5LiN6K6h5pS25pSv77yaM+eslCAwLjAw5YWDCgrnibnliKvmj5DnpLrvvJoKMS4g5pys5paH5qGj5LuF5L2c5Li65pSv5LuY5a6d55S15a2Q5a6i5oi35Zue5Y2V44CCCjIuIOivt+WLv+WwhuacrOaWh+aho+S9nOS4uuaUtuasvuWHreivgeS9v+eUqOOAggoKLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t5pSv5LuY5a6d77yI5Lit5Zu977yJ572R57uc5oqA5pyv5pyJ6ZmQ5YWs5Y+4ICDnlLXlrZDlrqLmiLflm57ljZUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0K5Lqk5piT5pe26Ze0LOS6pOaYk+WIhuexuyzkuqTmmJPlr7nmlrks5a+55pa56LSm5Y+3LOWVhuWTgeivtOaYjizmlLYv5pSvLOmHkeminSzmlLYv5LuY5qy+5pa55byPLOS6pOaYk+eKtuaAgSzkuqTmmJPorqLljZXlj7cs5ZWG5a626K6i5Y2V5Y+3LOWkh+azqCwKMjAyNC0wMS0xNSAxMDozMDowMCzppJDppa7nvo7po58s5pif5be05YWLLGFjY291bnRAc3RhcmJ1Y2tzLmNvbSzlkpbllaEs5pSv5Ye6LDM1LjAwLOiKseWRlyzkuqTmmJPmiJDlip8sMjAyNDAxMTUyMjAwMTQ2MDc0MTQwMDAwMSxTQjIwMjQwMTE1MDAxLCwKMjAyNC0wMS0xNCAxNToyMDozMCzkuqTpgJrlh7rooYws5ru05ru05Ye66KGMLGNodSoqKkBkaWRpY2h1eGluZy5jb20s5b+r6L2mLOaUr+WHuiwyOC41MCzkvZnpop3lrp0s5Lqk5piT5oiQ5YqfLDIwMjQwMTE0MjIwMDE0NjA3NDE0MDAwMDIsREkyMDI0MDExNDAwMiwsCjIwMjQtMDEtMTMgMDk6MDA6MDAs6L2s6LSmLOW8oOS4iSx6aGFuZ3NhbkBlbWFpbC5jb20s6L2s6LSm5pS25qy+LOaUtuWFpSwxMDAuMDAs5L2Z6aKdLOS6pOaYk+aIkOWKnywyMDI0MDExMzIyMDAxNDYwNzQxNDAwMDAzLCzmnIvlj4vov5jmrL4sCg=="
const EU_FIXTURE_B64 = "VHJhZGVzCkhlYWRlcgpDbGllbnRBY2NvdW50SUQsQXNzZXQgQ2F0ZWdvcnksQ3VycmVuY3ksU3ltYm9sLERhdGUvVGltZSxRdWFudGl0eSxULiBQcmljZSxDLiBQcmljZSxQcm9jZWVkcyxDb21tL0ZlZSxCYXNpcyxSZWFsaXplZCBQL0wsTVRNIFAvTCxDb2RlClUxMjM0NTY3LFNUSyxVU0QsQUFQTCwyMDI0MDIxNTswOTMwMDAsMTAwLDE4NS41MCwxODYuMDAsMTg1NTAuMDAsLTEuMDAsMCwwLDAsTwpVMTIzNDU2NyxTVEssVVNELE1TRlQsMjAyNDAyMTY7MTAxNTAwLC01MCwzNzguMjUsMzc4LjUwLC0xODkxMi41MCwtMC41MCwwLDAsMCxDCgpDYXNoIFRyYW5zYWN0aW9ucwpIZWFkZXIKQ2xpZW50QWNjb3VudElELEN1cnJlbmN5LERhdGUvVGltZSxBbW91bnQsVHlwZSxEZXNjcmlwdGlvbixTeW1ib2wsQ29kZQpVMTIzNDU2NyxVU0QsMjAyNDAyMjAsNTAwLjAwLERpdmlkZW5kcyxBcHBsZSBJbmMsQUFQTCwKVTEyMzQ1NjcsVVNELDIwMjQwMjIxLC0yNS4wMCxPdGhlciBGZWVzLEFjY291bnQgTWFpbnRlbmFuY2UsLAo="

function decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export default {
  async fetch(): Promise<Response> {
    try {
      const cn = decode(CN_FIXTURE_B64)
      const eu = decode(EU_FIXTURE_B64)

      const cnDetected = await parserRegistry.detect(cn)
      const cnParsed = await parserRegistry.get("cn-alipay-mobile").parse(cn)
      const euDetected = await parserRegistry.detect(eu)
      const euParsed = await parserRegistry.get("eu-interactive-brokers").parse(eu)

      const ok =
        cnDetected === "cn-alipay-mobile" &&
        cnParsed.success &&
        cnParsed.data.length > 0 &&
        typeof cnParsed.data[0].metadata?.paymentMethod === "string" &&
        euDetected === "eu-interactive-brokers" &&
        euParsed.success &&
        euParsed.data.length === 4 &&
        euParsed.data[0].currency === "USD"
      if (!ok) {
        // A smoke must fail observably when the registry misbehaves.
        return Response.json(
          { error: "smoke mismatch", cnDetected, euDetected, cnParsed, euParsed },
          { status: 500 },
        )
      }

      return Response.json({
        runtime: "workerd",
        cn: {
          detected: cnDetected,
          rows: cnParsed.success ? cnParsed.data.length : null,
          fundingSource: cnParsed.success
            ? (cnParsed.data[0]?.metadata?.paymentMethod ?? null)
            : null,
        },
        eu: {
          detected: euDetected,
          rows: euParsed.success ? euParsed.data.length : null,
        },
      })
    } catch (err) {
      // A smoke test must fail observably, not as an opaque 500.
      const detail = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) }
      return Response.json({ error: detail }, { status: 500 })
    }
  },
}
