import type { ComponentType, ReactNode } from 'react';

export interface CardProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface CardHeaderProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface CardTitleProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface CardDescriptionProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface CardActionProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface CardContentProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface CardFooterProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export const Card: ComponentType<CardProps>;
export const CardHeader: ComponentType<CardHeaderProps>;
export const CardFooter: ComponentType<CardFooterProps>;
export const CardTitle: ComponentType<CardTitleProps>;
export const CardAction: ComponentType<CardActionProps>;
export const CardDescription: ComponentType<CardDescriptionProps>;
export const CardContent: ComponentType<CardContentProps>;
