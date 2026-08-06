import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { CheckCircle2, AlertCircle } from 'lucide-react';

// ── Compact Settings Card ─────────────────────────────────────────────────────
export interface SettingsCardProps {
  title: string;
  description?: string;
  icon: React.ElementType;
  accentColor?: 'slate' | 'red' | 'amber' | 'gold';
  children: React.ReactNode;
  index?: number;
  fullWidth?: boolean;
}

export const SettingsCard = ({ title, description, icon: Icon, accentColor = 'slate', children, index = 0, fullWidth }: SettingsCardProps) => {
  const colors = {
    slate: { icon: 'bg-executive-blue/5 text-executive-blue', border: 'border-surface-border' },
    red:   { icon: 'bg-status-danger/10 text-status-danger', border: 'border-status-danger/20 bg-status-danger/[0.03]' },
    amber: { icon: 'bg-executive-gold/10 text-executive-gold', border: 'border-executive-gold/20 bg-executive-gold/[0.03]' },
    gold:  { icon: 'bg-executive-gold/10 text-executive-gold', border: 'border-executive-gold/20' },
  }[accentColor];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.06 }}
      className={cn(
        'flex flex-col gap-3 p-4 bg-makam-glass backdrop-blur-xl border rounded-2xl',
        'shadow-[0_1px_8px_rgba(22,21,19,0.02)] hover:shadow-[0_6px_24px_rgba(22,21,19,0.05)]',
        'transition-all duration-300 hover:bg-surface-elevated',
        colors.border,
        fullWidth && 'col-span-full'
      )}
    >
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', colors.icon)}>
          <Icon className="w-4 h-4 stroke-[1.5]" />
        </div>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[12px] font-medium text-executive-blue tracking-tight font-serif">{title}</h3>
          {description && (
            <p className="text-[9px] text-text-tertiary uppercase tracking-[0.25em]">{description}</p>
          )}
        </div>
      </div>

      <div className="h-px bg-executive-blue/[0.04]" />

      {/* Card content */}
      <div className="flex flex-col gap-2.5">
        {children}
      </div>
    </motion.div>
  );
};

// ── Action Button ─────────────────────────────────────────────────────────────
export interface ActionButtonProps {
  onClick?: () => void;
  label?: React.ReactNode;
  htmlFor?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'warning';
  disabled?: boolean;
  className?: string;
}

export const ActionButton = ({ onClick, label, htmlFor, variant = 'primary', disabled, className }: ActionButtonProps) => {
  const styles = {
    primary:   'bg-executive-gold text-white hover:bg-executive-gold-hover shadow-lg shadow-executive-gold/20',
    secondary: 'bg-makam-glass text-executive-gold border border-executive-gold/[0.15] hover:bg-surface-elevated hover:shadow-sm',
    danger:    'bg-surface-elevated text-status-danger border border-status-danger/20 hover:bg-status-danger/10',
    warning:   'bg-executive-gold/10 text-executive-gold border border-executive-gold/20 hover:bg-executive-gold/20',
  }[variant];

  const cls = cn(
    'flex items-center justify-center gap-2 px-4 h-9 rounded-xl text-[9px] font-medium uppercase tracking-[0.25em]',
    'transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none',
    styles, className
  );

  if (htmlFor) {
    return <label htmlFor={htmlFor} className={cn(cls, 'cursor-pointer')}>{label}</label>;
  }

  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {label}
    </button>
  );
};

// ── Status Banner ─────────────────────────────────────────────────────────────
export const StatusBanner = ({ status }: { status: { type: 'success' | 'error' | 'loading'; message: string } | null }) => {
  if (!status) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl border text-[11px] font-medium',
        status.type === 'loading' ? 'bg-executive-blue/[0.03] border-executive-blue/10 text-executive-blue' :
        status.type === 'success' ? 'bg-status-success/10 border-status-success/20 text-status-success' :
        'bg-status-danger/10 border-status-danger/20 text-status-danger'
      )}
    >
      {status.type === 'loading' ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
      ) : status.type === 'success' ? (
        <CheckCircle2 className="w-4 h-4 flex-shrink-0 stroke-[1.5]" />
      ) : (
        <AlertCircle className="w-4 h-4 flex-shrink-0 stroke-[1.5]" />
      )}
      <span className="uppercase tracking-[0.2em]">{status.message}</span>
    </motion.div>
  );
};
