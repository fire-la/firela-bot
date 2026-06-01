import type { ComponentType } from 'react';
import type { DayPickerProps } from 'react-day-picker';

export interface CalendarProps extends DayPickerProps {
  className?: string;
  classNames?: Record<string, string>;
  showOutsideDays?: boolean;
  [key: string]: unknown;
}

export const Calendar: ComponentType<CalendarProps>;
