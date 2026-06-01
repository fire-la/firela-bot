import type { ComponentType } from 'react';

export interface NoticeModalProps {
  visible: boolean;
  onClose: () => void;
  isMobile?: boolean;
  defaultTab?: 'inApp' | 'system';
  unreadKeys?: string[];
  [key: string]: unknown;
}

export default function NoticeModal(props: NoticeModalProps): JSX.Element;
