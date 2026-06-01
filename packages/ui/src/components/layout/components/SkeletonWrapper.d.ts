import type { ComponentType, ReactNode } from 'react';

export interface SkeletonWrapperProps {
  loading?: boolean;
  type?: 'text' | 'navigation' | 'userArea' | 'image' | 'title' | 'sidebarNavItem' | 'sidebarGroupTitle' | 'sidebar' | 'button';
  count?: number;
  width?: number;
  height?: number;
  isMobile?: boolean;
  className?: string;
  collapsed?: boolean;
  showAdmin?: boolean;
  children?: ReactNode;
  [key: string]: unknown;
}

export default function SkeletonWrapper(props: SkeletonWrapperProps): JSX.Element;
