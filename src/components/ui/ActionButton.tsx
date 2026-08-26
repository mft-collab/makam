import React from 'react';
import { cn } from '../../lib/utils';

// components/settings/SharedUI.tsx içindeydi (bkz. tasarım denetimi) — ui/'a
// taşındı. ui/Button'dan BİLİNÇLİ olarak ayrı bir bileşen: Button her zaman
// bir <button>, ActionButton ise `htmlFor` verildiğinde tıklanabilir bir
// <label>'a dönüşebiliyor (ör. gizli bir dosya input'unu tetiklemek için) —
// bu, Button'ın API'sine polymorphic bir `as` prop'u eklemeden karşılanamayan
// gerçek bir davranış farkı, bu yüzden birleştirilmedi.
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
    primary:   'bg-executive-gold text-[color:var(--btn-primary-text)] hover:bg-executive-gold-hover shadow-lg shadow-executive-gold/20',
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
