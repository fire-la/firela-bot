import type { ComponentType, ReactNode } from 'react';

type PaginationSize = 'default' | 'sm' | 'lg' | 'icon';

export interface PaginationProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface PaginationContentProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface PaginationItemProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface PaginationLinkProps {
  className?: string;
  isActive?: boolean;
  size?: PaginationSize;
  children?: ReactNode;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  [key: string]: unknown;
}

export interface PaginationPreviousProps {
  className?: string;
  children?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  [key: string]: unknown;
}

export interface PaginationNextProps {
  className?: string;
  children?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  [key: string]: unknown;
}

export interface PaginationFirstProps {
  className?: string;
  children?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  [key: string]: unknown;
}

export interface PaginationLastProps {
  className?: string;
  children?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  [key: string]: unknown;
}

export interface PaginationEllipsisProps {
  className?: string;
  [key: string]: unknown;
}

export const Pagination: ComponentType<PaginationProps>;
export const PaginationContent: ComponentType<PaginationContentProps>;
export const PaginationEllipsis: ComponentType<PaginationEllipsisProps>;
export const PaginationFirst: ComponentType<PaginationFirstProps>;
export const PaginationItem: ComponentType<PaginationItemProps>;
export const PaginationLast: ComponentType<PaginationLastProps>;
export const PaginationLink: ComponentType<PaginationLinkProps>;
export const PaginationNext: ComponentType<PaginationNextProps>;
export const PaginationPrevious: ComponentType<PaginationPreviousProps>;
