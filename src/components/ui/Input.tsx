import React from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label className="text-[10px] font-medium text-text-muted uppercase tracking-[0.2em] px-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={cn(
            'makam-input w-full h-14 px-6 bg-makam-glass border border-makam-border/5 rounded-full text-[15px] font-light text-text-heading placeholder:text-text-muted/30 transition-all outline-none focus:border-executive-blue/20 focus:ring-8 focus:ring-executive-blue/5 shadow-inner',
            error && 'border-red-300 focus:border-red-500 focus:ring-red-500/10',
            className
          )}
          {...props}
        />
        {error && <span className="text-[10px] text-red-500 font-medium px-1 uppercase tracking-wider">{error}</span>}
      </div>
    );
  }
);
