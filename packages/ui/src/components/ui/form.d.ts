import type { ComponentType, ReactNode } from 'react';
import type { UseFormReturn, FieldValues, FieldPath, ControllerProps } from 'react-hook-form';

export interface FormFieldProps extends Omit<ControllerProps<FieldValues>, 'name'> {
  name: string;
  [key: string]: unknown;
}

export interface FormItemProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface FormLabelProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface FormControlProps {
  children?: ReactNode;
  [key: string]: unknown;
}

export interface FormDescriptionProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface FormMessageProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface FormFieldState {
  id: string;
  name: string;
  formItemId: string;
  formDescriptionId: string;
  formMessageId: string;
  error?: { message?: string };
  invalid: boolean;
  isDirty: boolean;
  isTouched: boolean;
}

export const Form: ComponentType<unknown>;
export const FormField: ComponentType<FormFieldProps>;
export const FormItem: ComponentType<FormItemProps>;
export const FormLabel: ComponentType<FormLabelProps>;
export const FormControl: ComponentType<FormControlProps>;
export const FormDescription: ComponentType<FormDescriptionProps>;
export const FormMessage: ComponentType<FormMessageProps>;

export function useFormField(): FormFieldState;
