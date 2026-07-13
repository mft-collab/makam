import React from 'react';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  /** Opsiyonel ikon (ör. <ListChecks className="w-8 h-8" />) */
  icon?: React.ReactNode;
  message: string;
  /** Opsiyonel aksiyon (buton/link) */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Sekmelerdeki boş-durum kutuları için ortak bileşen.
 * Tutarlı padding, renk ve border stili sağlar.
 */
export const EmptyState = ({ icon, message, action, className }: EmptyStateProps) => (
  <div
    className={cn(
      'py-16 px-4 flex flex-col items-center justify-center gap-3 text-center',
      'text-text-tertiary uppercase tracking-[0.18em] text-[10px] font-medium',
      'border border-dashed border-makam-border/10 rounded-2xl',
      className
    )}
  >
    {icon && (
      <span aria-hidden="true" className="opacity-30 flex items-center justify-center">
        {icon}
      </span>
    )}
    <span>{message}</span>
    {action}
  </div>
);
