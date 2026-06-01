import type { ComponentType, ReactNode, RefAttributes } from 'react';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';

export interface BadgeProps extends RefAttributes<HTMLSpanElement> {
  className?: string;
  variant?: BadgeVariant;
  children?: ReactNode;
}

export const Badge: ComponentType<BadgeProps>;
