import type { ComponentType, ReactNode } from 'react';

export interface AvatarProps { className?: string; children?: ReactNode; }
export interface AvatarImageProps { src?: string; alt?: string; className?: string; }
export interface AvatarFallbackProps { className?: string; children?: ReactNode; }

export const Avatar: ComponentType<AvatarProps>;
export const AvatarImage: ComponentType<AvatarImageProps>;
export const AvatarFallback: ComponentType<AvatarFallbackProps>;
