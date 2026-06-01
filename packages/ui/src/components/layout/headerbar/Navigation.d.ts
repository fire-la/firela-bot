import type { ComponentType, ReactNode } from 'react';

export interface NavLinkItem {
  itemKey: string;
  text: string;
  to?: string;
  isExternal?: boolean;
  externalLink?: string;
  [key: string]: unknown;
}

export interface NavigationProps {
  mainNavLinks: NavLinkItem[];
  isMobile: boolean;
  isLoading: boolean;
  userState: {
    user?: {
      username: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  pricingRequireAuth: boolean;
  [key: string]: unknown;
}

export default function Navigation(props: NavigationProps): JSX.Element;
