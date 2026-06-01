import type { ComponentType, ReactNode } from 'react';

export interface DialogProps {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  [key: string]: unknown;
}

export interface DialogTriggerProps {
  children?: ReactNode;
  asChild?: boolean;
  className?: string;
  [key: string]: unknown;
}

export interface DialogPortalProps {
  children?: ReactNode;
  [key: string]: unknown;
}

export interface DialogCloseProps {
  children?: ReactNode;
  className?: string;
  [key: string]: unknown;
}

export interface DialogOverlayProps {
  className?: string;
  [key: string]: unknown;
}

export interface DialogContentProps {
  className?: string;
  children?: ReactNode;
  showClose?: boolean;
  [key: string]: unknown;
}

export interface DialogHeaderProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface DialogFooterProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface DialogTitleProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface DialogDescriptionProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Dialog: ComponentType<DialogProps>;
export const DialogPortal: ComponentType<DialogPortalProps>;
export const DialogOverlay: ComponentType<DialogOverlayProps>;
export const DialogTrigger: ComponentType<DialogTriggerProps>;
export const DialogClose: ComponentType<DialogCloseProps>;
export const DialogContent: ComponentType<DialogContentProps>;
export const DialogHeader: ComponentType<DialogHeaderProps>;
export const DialogFooter: ComponentType<DialogFooterProps>;
export const DialogTitle: ComponentType<DialogTitleProps>;
export const DialogDescription: ComponentType<DialogDescriptionProps>;
