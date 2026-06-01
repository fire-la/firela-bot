import type { ComponentType, ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  [key: string]: unknown;
}

export function PageHeader(props: PageHeaderProps): JSX.Element;
