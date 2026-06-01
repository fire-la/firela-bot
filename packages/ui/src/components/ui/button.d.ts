import type { ComponentType, ReactNode, RefAttributes } from 'react';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm';

export interface ButtonProps extends RefAttributes<HTMLButtonElement> {
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children?: ReactNode;
  title?: string;
  'aria-label'?: string;
}

export const Button: ComponentType<ButtonProps>;
export const buttonVariants: (props: { variant?: ButtonVariant; size?: ButtonSize; className?: string }) => string;
