import type { ComponentType, ReactNode } from 'react';

export interface PageWrapperProps {
  children: ReactNode;
  [key: string]: unknown;
}

export function PageWrapper(props: PageWrapperProps): JSX.Element;
