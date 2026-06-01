import type { ComponentType, ReactNode, RefAttributes } from 'react';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm';

export interface SidebarProps {
  children?: ReactNode;
  collapsible?: 'offcanvas' | 'icon' | 'none';
  className?: string;
  side?: 'left' | 'right';
}

export interface SidebarContentProps { className?: string; children?: ReactNode; }
export interface SidebarHeaderProps { className?: string; children?: ReactNode; }
export interface SidebarFooterProps { className?: string; children?: ReactNode; }
export interface SidebarGroupProps { className?: string; children?: ReactNode; }
export interface SidebarGroupContentProps { className?: string; children?: ReactNode; }
export interface SidebarGroupLabelProps { className?: string; children?: ReactNode; }
export interface SidebarMenuProps { className?: string; children?: ReactNode; }
export interface SidebarMenuItemProps { className?: string; children?: ReactNode; }
export interface SidebarMenuSubProps { className?: string; children?: ReactNode; }
export interface SidebarMenuSubItemProps { className?: string; children?: ReactNode; }
export interface SidebarRailProps { className?: string; }

export interface SidebarMenuButtonProps extends RefAttributes<HTMLButtonElement> {
  className?: string;
  children?: ReactNode;
  isActive?: boolean;
  tooltip?: string;
  size?: 'default' | 'sm' | 'lg';
  onClick?: () => void;
  asChild?: boolean;
}

export interface SidebarMenuSubButtonProps extends RefAttributes<HTMLButtonElement> {
  className?: string;
  children?: ReactNode;
  isActive?: boolean;
  size?: 'default' | 'sm' | 'lg';
  asChild?: boolean;
}

type SidebarState = 'expanded' | 'collapsed';

export interface UseSidebarReturn {
  state: SidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const Sidebar: ComponentType<SidebarProps>;
export const SidebarContent: ComponentType<SidebarContentProps>;
export const SidebarHeader: ComponentType<SidebarHeaderProps>;
export const SidebarFooter: ComponentType<SidebarFooterProps>;
export const SidebarGroup: ComponentType<SidebarGroupProps>;
export const SidebarGroupContent: ComponentType<SidebarGroupContentProps>;
export const SidebarGroupLabel: ComponentType<SidebarGroupLabelProps>;
export const SidebarMenu: ComponentType<SidebarMenuProps>;
export const SidebarMenuItem: ComponentType<SidebarMenuItemProps>;
export const SidebarMenuButton: ComponentType<SidebarMenuButtonProps>;
export const SidebarMenuSub: ComponentType<SidebarMenuSubProps>;
export const SidebarMenuSubButton: ComponentType<SidebarMenuSubButtonProps>;
export const SidebarMenuSubItem: ComponentType<SidebarMenuSubItemProps>;
export const SidebarRail: ComponentType<SidebarRailProps>;
export function useSidebar(): UseSidebarReturn;
