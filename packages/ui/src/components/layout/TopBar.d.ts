import type { ComponentType, ReactNode } from 'react';

export interface TopBarProps {
  user?: {
    username?: string;
    [key: string]: unknown;
  };
  onLogout: () => void;
  onMenuClick: () => void;
  isMobileMenuOpen: boolean;
  systemName?: string;
  [key: string]: unknown;
}

export function TopBar(props: TopBarProps): JSX.Element;
