import type { ComponentType, ReactNode } from 'react';

type AlertVariant = 'default' | 'destructive';

export interface AlertProps {
  className?: string;
  variant?: AlertVariant;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface AlertTitleProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface AlertDescriptionProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Alert: ComponentType<AlertProps>;
export const AlertTitle: ComponentType<AlertTitleProps>;
export const AlertDescription: ComponentType<AlertDescriptionProps>;
