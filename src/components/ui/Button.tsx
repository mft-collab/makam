import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold' | 'success';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, ...props }, ref) => {
    const variants = {
      primary: 'makam-button-primary',
      secondary: 'makam-button-secondary',
      // Tema-duyarlı: status-danger/status-success token'ları .dark altında
      // otomatik olarak daha açık bir tona geçer (bkz. index.css)
      danger: 'bg-status-danger/10 text-status-danger hover:bg-status-danger/15 border border-status-danger/20 shadow-sm',
      ghost: 'bg-transparent hover:bg-executive-blue/[0.02] text-text-muted hover:text-executive-blue border-transparent',
      gold: 'bg-executive-gold text-white hover:bg-executive-gold-hover shadow-lg shadow-executive-gold/20',
      success: 'bg-status-success text-white hover:opacity-90 shadow-lg shadow-status-success/10',
    };

    const sizes = {
      sm: 'px-5 py-2.5 text-[10px] tracking-[0.2em]',
      md: 'px-8 py-4 text-[11px] tracking-[0.3em]',
      lg: 'px-12 py-5 text-[13px] tracking-[0.18em]',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'makam-button inline-flex items-center justify-center gap-3 transition-all duration-500 rounded-full',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2',
          variants[variant],
          sizes[size],
          (isLoading || props.disabled) && 'opacity-60 cursor-not-allowed',
          className
        )}
        disabled={isLoading || props.disabled}
        aria-busy={isLoading ? true : undefined}
        aria-disabled={isLoading || props.disabled ? true : undefined}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin h-4 w-4 text-current"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
