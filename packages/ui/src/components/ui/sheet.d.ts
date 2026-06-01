import type { ComponentType, ReactNode } from 'react';

type SheetSide = 'top' | 'bottom' | 'left' | 'right';

export interface SheetProps {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  [key: string]: unknown;
}

export interface SheetTriggerProps {
  children?: ReactNode;
  asChild?: boolean;
  className?: string;
  [key: string]: unknown;
}

export interface SheetCloseProps {
  children?: ReactNode;
  className?: string;
  [key: string]: unknown;
}

export interface SheetContentProps {
  className?: string;
  children?: ReactNode;
  side?: SheetSide;
  showCloseButton?: boolean;
  [key: string]: unknown;
}

export interface SheetHeaderProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface SheetFooterProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface SheetTitleProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface SheetDescriptionProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Sheet: ComponentType<SheetProps>;
export const SheetTrigger: ComponentType<SheetTriggerProps>;
export const SheetClose: ComponentType<SheetCloseProps>;
export const SheetContent: ComponentType<SheetContentProps>;
export const SheetHeader: ComponentType<SheetHeaderProps>;
export const SheetFooter: ComponentType<SheetFooterProps>;
export const SheetTitle: ComponentType<SheetTitleProps>;
export const SheetDescription: ComponentType<SheetDescriptionProps>;
