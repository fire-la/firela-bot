import type { ComponentType } from 'react';

export interface HeaderBarProps {
  onMobileMenuToggle?: () => void;
  drawerOpen?: boolean;
  [key: string]: unknown;
}

export default function HeaderBar(props: HeaderBarProps): JSX.Element;
