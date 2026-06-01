import type { ComponentType } from 'react';

export interface NotificationButtonProps {
  unreadCount: number;
  onNoticeOpen: () => void;
  t: (key: string) => string;
  [key: string]: unknown;
}

export default function NotificationButton(props: NotificationButtonProps): JSX.Element;
