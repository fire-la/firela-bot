import type { ComponentType, ReactNode } from 'react';

export interface AlertDialogProps { children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; [key: string]: unknown }
export interface AlertDialogTriggerProps { children?: ReactNode; asChild?: boolean; className?: string; [key: string]: unknown }
export interface AlertDialogContentProps { className?: string; children?: ReactNode; [key: string]: unknown }
export interface AlertDialogHeaderProps { className?: string; children?: ReactNode; [key: string]: unknown }
export interface AlertDialogFooterProps { className?: string; children?: ReactNode; [key: string]: unknown }
export interface AlertDialogTitleProps { className?: string; children?: ReactNode; [key: string]: unknown }
export interface AlertDialogDescriptionProps { children?: ReactNode; asChild?: boolean; className?: string; [key: string]: unknown }
export interface AlertDialogActionProps { className?: string; children?: ReactNode; onClick?: () => void; disabled?: boolean; [key: string]: unknown }
export interface AlertDialogCancelProps { className?: string; children?: ReactNode; onClick?: () => void; [key: string]: unknown }
export interface AlertDialogOverlayProps { className?: string; [key: string]: unknown }

export const AlertDialog: ComponentType<AlertDialogProps>;
export const AlertDialogTrigger: ComponentType<AlertDialogTriggerProps>;
export const AlertDialogContent: ComponentType<AlertDialogContentProps>;
export const AlertDialogHeader: ComponentType<AlertDialogHeaderProps>;
export const AlertDialogFooter: ComponentType<AlertDialogFooterProps>;
export const AlertDialogTitle: ComponentType<AlertDialogTitleProps>;
export const AlertDialogDescription: ComponentType<AlertDialogDescriptionProps>;
export const AlertDialogAction: ComponentType<AlertDialogActionProps>;
export const AlertDialogCancel: ComponentType<AlertDialogCancelProps>;
export const AlertDialogOverlay: ComponentType<AlertDialogOverlayProps>;
