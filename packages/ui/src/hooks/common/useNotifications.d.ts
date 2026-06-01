export interface UseNotificationsReturn {
  noticeVisible: boolean;
  unreadCount: number;
  announcements: Array<{
    content: string;
    publishDate: string;
    type?: string;
    extra?: string;
    [key: string]: unknown;
  }>;
  handleNoticeOpen: () => void;
  handleNoticeClose: () => void;
  getUnreadKeys: () => string[];
}

export function useNotifications(statusState: {
  status?: {
    announcements?: Array<{
      content: string;
      publishDate: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}): UseNotificationsReturn;
