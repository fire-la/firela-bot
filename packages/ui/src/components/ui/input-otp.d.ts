import type { ComponentType, ReactNode } from 'react';
import type { OTPInputProps } from 'input-otp';

export interface InputOTPProps extends OTPInputProps {
  className?: string;
  containerClassName?: string;
  [key: string]: unknown;
}

export interface InputOTPGroupProps {
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface InputOTPSlotProps {
  index: number;
  className?: string;
  [key: string]: unknown;
}

export interface InputOTPSeparatorProps {
  [key: string]: unknown;
}

export const InputOTP: ComponentType<InputOTPProps>;
export const InputOTPGroup: ComponentType<InputOTPGroupProps>;
export const InputOTPSlot: ComponentType<InputOTPSlotProps>;
export const InputOTPSeparator: ComponentType<InputOTPSeparatorProps>;
