import type { ComponentType } from 'react';

export interface LanguageSelectorProps {
  currentLang: string;
  onLanguageChange: (lang: string) => void;
  t: (key: string) => string;
  [key: string]: unknown;
}

export default function LanguageSelector(props: LanguageSelectorProps): JSX.Element;
