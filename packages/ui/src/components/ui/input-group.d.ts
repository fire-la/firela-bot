import type { ComponentType, ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

type InputGroupAddonAlign = 'inline-start' | 'inline-end' | 'block-start' | 'block-end';
type InputGroupButtonSize = 'xs' | 'sm' | 'icon-xs' | 'icon-sm';

export interface InputGroupProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface InputGroupAddonProps {
  className?: string;
  align?: InputGroupAddonAlign;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface InputGroupButtonProps {
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  variant?: string;
  size?: InputGroupButtonSize;
  disabled?: boolean;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface InputGroupTextProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface InputGroupInputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  [key: string]: unknown;
}

export interface InputGroupTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
  [key: string]: unknown;
}

export const InputGroup: ComponentType<InputGroupProps>;
export const InputGroupAddon: ComponentType<InputGroupAddonProps>;
export const InputGroupButton: ComponentType<InputGroupButtonProps>;
export const InputGroupText: ComponentType<InputGroupTextProps>;
export const InputGroupInput: ComponentType<InputGroupInputProps>;
export const InputGroupTextarea: ComponentType<InputGroupTextareaProps>;
