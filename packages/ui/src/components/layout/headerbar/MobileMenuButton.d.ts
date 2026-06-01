import type { ComponentType } from 'react';

export interface MobileMenuButtonProps {
  isConsoleRoute: boolean;
  isMobile: boolean;
  openMobile: boolean;
  collapsed: boolean;
  onToggle: () => void;
  t: (key: string) => string;
  [key: string]: unknown;
}

export default function MobileMenuButton(props: MobileMenuButtonProps): JSX.Element;
