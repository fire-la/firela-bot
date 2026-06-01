export interface UseHeaderBarParams {
  onMobileMenuToggle?: () => void;
  drawerOpen?: boolean;
  [key: string]: unknown;
}

export interface UseHeaderBarReturn {
  userState: {
    user?: {
      username: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  statusState: {
    status?: {
      self_use_mode_enabled?: boolean;
      docs_link?: string;
      demo_site_enabled?: boolean;
      HeaderNavModules?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  isMobile: boolean;
  collapsed: boolean;
  openMobile: boolean;
  logoLoaded: boolean;
  currentLang: string;
  location: {
    pathname: string;
    [key: string]: unknown;
  };
  isLoading: boolean;
  systemName: string;
  logo: string;
  isNewYear: boolean;
  isSelfUseMode: boolean;
  docsLink: string;
  isDemoSiteMode: boolean;
  isConsoleRoute: boolean;
  theme: string;
  drawerOpen: boolean;
  headerNavModules: Record<string, unknown> | null;
  pricingRequireAuth: boolean;
  logout: () => Promise<void>;
  handleLanguageChange: (lang: string) => void;
  handleThemeToggle: (newTheme: string) => void;
  handleMobileMenuToggle: () => void;
  navigate: (path: string) => void;
  t: (key: string) => string;
}

export function useHeaderBar(params: UseHeaderBarParams): UseHeaderBarReturn;
