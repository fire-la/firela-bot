import type { ComponentType, ReactNode } from 'react';

export interface PageLayoutProps {
  children: ReactNode;
  menuItems?: Array<{
    [key: string]: unknown;
  }>;
  user?: {
    username?: string;
    [key: string]: unknown;
  };
  onLogout?: () => void;
  systemName?: string;
  logo?: string;
  [key: string]: unknown;
}

export const PageLayout: ComponentType<PageLayoutProps>;
export default PageLayout;
