import type { ComponentType, ReactNode } from 'react';

export interface PageShellProps {
  children: ReactNode;
  className?: string;
  [key: string]: unknown;
}

export function PageShell(props: PageShellProps): JSX.Element;
