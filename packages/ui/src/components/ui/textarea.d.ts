import type { ComponentType, TextareaHTMLAttributes, ReactNode } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
  [key: string]: unknown;
}

export const Textarea: ComponentType<TextareaProps>;
