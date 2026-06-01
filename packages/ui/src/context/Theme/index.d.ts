import type { ComponentType, ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface ThemeProviderProps {
  children: ReactNode;
  [key: string]: unknown;
}

export const ThemeProvider: ComponentType<ThemeProviderProps>;
export function useTheme(): ThemeMode;
export function useActualTheme(): 'light' | 'dark';
export function useSetTheme(): (theme: ThemeMode | boolean) => void;
