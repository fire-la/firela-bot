import type { ComponentType } from 'react';

export interface HeaderLogoProps {
  isMobile: boolean;
  isConsoleRoute: boolean;
  logo: string;
  logoLoaded: boolean;
  isLoading: boolean;
  [key: string]: unknown;
}

export default function HeaderLogo(props: HeaderLogoProps): JSX.Element;
