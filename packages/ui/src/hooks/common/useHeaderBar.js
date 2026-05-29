import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserContext } from '../../context/User';
import { StatusContext } from '../../context/Status';
import { useSetTheme, useTheme, useActualTheme } from '../../context/Theme';
import { getLogo, getSystemName, API, showSuccess } from '../../helpers';
import { useIsMobile } from './useIsMobile';
import { useSidebar } from '@/components/ui/sidebar';
import { useMinimumLoadingTime } from './useMinimumLoadingTime';

export const useHeaderBar = ({ onMobileMenuToggle: _onMobileMenuToggle, drawerOpen }) => {
  const { t, i18n } = useTranslation();
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState] = useContext(StatusContext);
  const isMobile = useIsMobile();
  const { state, openMobile, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed';
  const [logoLoaded, setLogoLoaded] = useState(false);
  const navigate = useNavigate();
  const [currentLang, setCurrentLang] = useState(i18n.language);
  const location = useLocation();

  const loading = statusState?.status === undefined;
  const isLoading = useMinimumLoadingTime(loading, 200);

  const systemName = getSystemName();
  const logo = getLogo();
  const currentDate = new Date();
  const isNewYear = currentDate.getMonth() === 0 && currentDate.getDate() === 1;

  const isSelfUseMode = statusState?.status?.self_use_mode_enabled || false;
  const docsLink = statusState?.status?.docs_link || '';
  const isDemoSiteMode = statusState?.status?.demo_site_enabled || false;

  // Get header bar module config
  const headerNavModulesConfig = statusState?.status?.HeaderNavModules;

  // Use useMemo to ensure headerNavModules responds correctly to statusState changes
  const headerNavModules = useMemo(() => {
    if (headerNavModulesConfig) {
      try {
        const modules = JSON.parse(headerNavModulesConfig);

        // Handle backward compatibility: if pricing is boolean, convert to object format
        if (typeof modules.pricing === 'boolean') {
          modules.pricing = {
            enabled: modules.pricing,
            requireAuth: false, // Default: no login required
          };
        }

        return modules;
      } catch (error) {
        console.error('Failed to parse header nav modules config:', error);
        return null;
      }
    }
    return null;
  }, [headerNavModulesConfig]);

  // Get pricing require auth config
  const pricingRequireAuth = useMemo(() => {
    if (headerNavModules?.pricing) {
      return typeof headerNavModules.pricing === 'object'
        ? headerNavModules.pricing.requireAuth
        : false; // Default: no login required
    }
    return false; // Default: no login required
  }, [headerNavModules]);

  // All firela-bot pages use unified PageLayout with sidebar
  const isConsoleRoute = true;

  const theme = useTheme();
  const actualTheme = useActualTheme();
  const setTheme = useSetTheme();

  // Logo loading effect
  useEffect(() => {
    setLogoLoaded(false);
    if (!logo) return;
    const img = new Image();
    img.src = logo;
    img.onload = () => setLogoLoaded(true);
  }, [logo]);

  // Send theme to iframe
  useEffect(() => {
    try {
      const iframe = document.querySelector('iframe');
      const cw = iframe && iframe.contentWindow;
      if (cw) {
        cw.postMessage({ themeMode: actualTheme }, '*');
      }
    } catch {
      // Silently ignore cross-origin or access errors
    }
  }, [actualTheme]);

  // Language change effect
  useEffect(() => {
    const handleLanguageChanged = (lng) => {
      setCurrentLang(lng);
      try {
        const iframe = document.querySelector('iframe');
        const cw = iframe && iframe.contentWindow;
        if (cw) {
          cw.postMessage({ lang: lng }, '*');
        }
      } catch {
        // Silently ignore cross-origin or access errors
      }
    };

    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [i18n]);

  // Actions
  const logout = useCallback(async () => {
    await API.get('/api/user/logout');
    showSuccess(t('Logout successful!'));
    userDispatch({ type: 'logout' });
    localStorage.removeItem('user');
    navigate('/login');
  }, [navigate, t, userDispatch]);

  const handleLanguageChange = useCallback(
    (lang) => {
      i18n.changeLanguage(lang);
    },
    [i18n],
  );

  const handleThemeToggle = useCallback(
    (newTheme) => {
      if (
        !newTheme ||
        (newTheme !== 'light' && newTheme !== 'dark' && newTheme !== 'auto')
      ) {
        return;
      }
      setTheme(newTheme);
    },
    [setTheme],
  );

  const handleMobileMenuToggle = useCallback(() => {
    // Shadcn's toggleSidebar handles both mobile (Sheet) and desktop (collapse)
    toggleSidebar();
  }, [toggleSidebar]);

  return {
    // State
    userState,
    statusState,
    isMobile,
    collapsed,
    openMobile,
    logoLoaded,
    currentLang,
    location,
    isLoading,
    systemName,
    logo,
    isNewYear,
    isSelfUseMode,
    docsLink,
    isDemoSiteMode,
    isConsoleRoute,
    theme,
    drawerOpen,
    headerNavModules,
    pricingRequireAuth,

    // Actions
    logout,
    handleLanguageChange,
    handleThemeToggle,
    handleMobileMenuToggle,
    navigate,
    t,
  };
};
