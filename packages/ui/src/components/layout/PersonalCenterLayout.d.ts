import type { ComponentType, ReactNode } from 'react';

export interface PersonalCenterLayoutProps {
  children: ReactNode;
  [key: string]: unknown;
}

export function PersonalCenterLayout(props: PersonalCenterLayoutProps): JSX.Element;
