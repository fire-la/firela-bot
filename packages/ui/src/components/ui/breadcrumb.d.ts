import type { ComponentType, ReactNode } from 'react';

export interface BreadcrumbProps {
  children?: ReactNode;
  className?: string;
  [key: string]: unknown;
}

export interface BreadcrumbListProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface BreadcrumbItemProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface BreadcrumbLinkProps {
  asChild?: boolean;
  className?: string;
  children?: ReactNode;
  href?: string;
  [key: string]: unknown;
}

export interface BreadcrumbPageProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface BreadcrumbSeparatorProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface BreadcrumbEllipsisProps {
  className?: string;
  [key: string]: unknown;
}

export const Breadcrumb: ComponentType<BreadcrumbProps>;
export const BreadcrumbList: ComponentType<BreadcrumbListProps>;
export const BreadcrumbItem: ComponentType<BreadcrumbItemProps>;
export const BreadcrumbLink: ComponentType<BreadcrumbLinkProps>;
export const BreadcrumbPage: ComponentType<BreadcrumbPageProps>;
export const BreadcrumbSeparator: ComponentType<BreadcrumbSeparatorProps>;
export const BreadcrumbEllipsis: ComponentType<BreadcrumbEllipsisProps>;
