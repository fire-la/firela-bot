/**
 * BillClaw UI - Main App Component
 *
 * Router setup for OAuth and configuration pages.
 * Includes service toggle state management and route protection.
 */
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Link2, RefreshCw, Download, Cloud, Webhook, Settings, QrCode } from "lucide-react"
import { getLogo } from "@/helpers"
import { ServiceStateProvider } from "@/contexts/ServiceStateContext"
import { ThemeProvider } from "@/context/Theme"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import { PageLayout } from "@/components/layout/PageLayout"
import { ConnectPage } from "@/components/pages/ConnectPage"
import { SyncPage } from "@/components/pages/SyncPage"
import { ExportPage } from "@/components/pages/ExportPage"
import { VltPage } from "@/components/pages/VltPage"
import { WebhooksPage } from "@/components/pages/WebhooksPage"
import { SettingsPage } from "@/components/pages/SettingsPage"
import { PairAppPage } from "@/components/pages/PairAppPage"
import { AuthSetupPage } from "@/components/pages/AuthSetupPage"
import { PlaidConnectPage } from "@/components/pages/PlaidConnectPage"
import { GmailConnectPage } from "@/components/pages/GmailConnectPage"
import { GoCardlessConnectPage } from "@/components/pages/GoCardlessConnectPage"
import { isOwnerUser } from "@/lib/auth"

/**
 * BillClaw sidebar menu configuration
 */
const billclawMenuItems = [
  {
    label: "Account",
    items: [
      { text: "Connect", itemKey: "connect", to: "/connect", icon: Link2 },
      { text: "Sync", itemKey: "sync", to: "/sync", icon: RefreshCw },
      { text: "Pair app", itemKey: "pair", to: "/pair", icon: QrCode },
    ],
  },
  {
    label: "Export",
    items: [
      { text: "Beancount/Ledger", itemKey: "export", to: "/export", icon: Download },
      { text: "Firela VLT Integration", itemKey: "vlt", to: "/vlt", icon: Cloud },
    ],
  },
  {
    label: "System",
    items: [
      { text: "Webhooks", itemKey: "webhooks", to: "/webhooks", icon: Webhook },
      { text: "Settings", itemKey: "settings", to: "/settings", icon: Settings },
    ],
  },
]

/** Nav item keys whose API calls 403 under an app token (dead-end affordances). */
const OWNER_ONLY_NAV_KEYS = new Set(["connect", "export", "vlt", "webhooks", "settings", "pair"])

/**
 * Sidebar menu filtered by role. The `app` role (firela-app WebView) can only
 * use Sync, so owner-only sections are hidden to avoid buttons that 403 on click.
 */
function menuItemsForRole() {
  if (isOwnerUser()) return billclawMenuItems
  return billclawMenuItems
    .map((section) => ({
      ...section,
      items: section.items.filter((it) => !OWNER_ONLY_NAV_KEYS.has(it.itemKey)),
    }))
    .filter((section) => section.items.length > 0)
}

export function App() {
  // App-role tokens can only reach Sync; hide owner-only nav so the WebView
  // dashboard shows no dead-end buttons.
  const menuItems = menuItemsForRole()
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ServiceStateProvider>
          <Routes>
          {/* Main configuration routes with layout */}
          <Route
            path="/"
            element={
              <ProtectedRoute serviceId="billclaw">
                <PageLayout menuItems={menuItems} systemName="connect" logo={getLogo()}>
                  <HomePage />
                </PageLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/connect"
            element={
              <ProtectedRoute serviceId="billclaw">
                <PageLayout menuItems={menuItems} systemName="connect" logo={getLogo()}>
                  <ConnectPage />
                </PageLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sync"
            element={
              <ProtectedRoute serviceId="billclaw">
                <PageLayout menuItems={menuItems} systemName="connect" logo={getLogo()}>
                  <SyncPage />
                </PageLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/export"
            element={
              <ProtectedRoute serviceId="billclaw">
                <PageLayout menuItems={menuItems} systemName="connect" logo={getLogo()}>
                  <ExportPage />
                </PageLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/vlt"
            element={
              <ProtectedRoute serviceId="billclaw">
                <PageLayout menuItems={menuItems} systemName="connect" logo={getLogo()}>
                  <VltPage />
                </PageLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/webhooks"
            element={
              <ProtectedRoute serviceId="billclaw">
                <PageLayout menuItems={menuItems} systemName="connect" logo={getLogo()}>
                  <WebhooksPage />
                </PageLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute serviceId="billclaw">
                <PageLayout menuItems={menuItems} systemName="connect" logo={getLogo()}>
                  <SettingsPage />
                </PageLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/pair"
            element={
              <ProtectedRoute serviceId="billclaw">
                <PageLayout menuItems={menuItems} systemName="connect" logo={getLogo()}>
                  <PairAppPage />
                </PageLayout>
              </ProtectedRoute>
            }
          />

          {/* Auth routes - full page, no layout */}
          <Route path="/auth/setup" element={<AuthSetupPage />} />

          {/* OAuth routes without layout (full-page OAuth flows) - UNPROTECTED */}
          <Route path="/connect/plaid" element={<PlaidConnectPage />} />
          <Route path="/connect/gmail" element={<GmailConnectPage />} />
          <Route path="/connect/gocardless" element={<GoCardlessConnectPage />} />
          <Route path="/gmail-callback" element={<GmailConnectPage />} />
        </Routes>
        </ServiceStateProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

// Placeholder home page
function HomePage() {
  return (
    <div className="placeholder-page">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">
        Welcome to BillClaw
      </h1>
      <p className="text-gray-600">
        Use the sidebar to navigate to configuration sections.
      </p>
    </div>
  )
}
