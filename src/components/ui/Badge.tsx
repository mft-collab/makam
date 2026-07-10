import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
  withPulse?: boolean;
  icon?: React.ReactNode;
}

export const Badge = ({ 
  variant = 'default', 
  className, 
  children, 
  withPulse = false,
  icon,
  ...props 
}: BadgeProps) => {
  const baseStyle = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] font-medium uppercase tracking-[0.2em] shadow-sm backdrop-blur-xl transition-all duration-300 select-none';

  const variants = {
    default: 'bg-makam-glass border-slate-200/60 text-text-muted shadow-[inset_0_1px_1px_rgba(255,255,255,0.6)]',
    success: 'bg-emerald-500/[0.04] border-emerald-500/25 text-emerald-600 shadow-[0_4px_16px_rgba(16,185,129,0.06),inset_0_1px_1px_rgba(255,255,255,0.15)]',
    warning: 'bg-[#C5A059]/[0.06] border-[#C5A059]/30 text-[#C5A059] shadow-[0_4px_16px_rgba(197,160,89,0.06),inset_0_1px_1px_rgba(255,255,255,0.15)]',
    danger: 'bg-gradient-to-br from-red-950/20 via-red-900/5 to-transparent border-red-500/30 text-red-500 shadow-[0_4px_20px_rgba(239,68,68,0.12),inset_0_1px_1.5px_rgba(255,255,255,0.06)]',
    info: 'bg-blue-500/[0.04] border-blue-500/20 text-blue-600 shadow-[0_4px_16px_rgba(59,130,246,0.06),inset_0_1px_1px_rgba(255,255,255,0.15)]',
    primary: 'bg-executive-blue/[0.05] border-executive-blue/15 text-executive-blue shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]',
  };

  return (
    <span
      className={cn(baseStyle, variants[variant], className)}
      {...props}
    >
      {/* Organic Pulsing Core */}
      {withPulse && (
        <span className="relative flex h-1.5 w-1.5 mr-0.5">
          <span className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
            variant === 'danger' ? "bg-red-400" :
            variant === 'warning' ? "bg-[#C5A059]" :
            variant === 'success' ? "bg-emerald-400" : "bg-blue-400"
          )} />
          <span className={cn(
            "relative inline-flex rounded-full h-1.5 w-1.5",
            variant === 'danger' ? "bg-red-500 shadow-[0_0_6px_#ef4444]" :
            variant === 'warning' ? "bg-[#C5A059] shadow-[0_0_6px_#C5A059]" :
            variant === 'success' ? "bg-emerald-500 shadow-[0_0_6px_#10B981]" :
            "bg-blue-500 shadow-[0_0_6px_#3b82f6]"
          )} />
        </span>
      )}
      
      {icon && <span className="flex-shrink-0 opacity-80 flex items-center justify-center">{icon}</span>}
      <span className="leading-none">{children}</span>
    </span>
  );
};
