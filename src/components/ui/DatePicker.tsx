import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format, parse, addMonths, subMonths, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, addDays, isSameDay, isSameMonth, isToday
} from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '../../lib/utils';

const WEEKDAY_LABELS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
const VALUE_FORMAT = 'yyyy-MM-dd';

const parseValue = (value: string): Date | null => {
  const d = parse(value, VALUE_FORMAT, new Date());
  return Number.isNaN(d.getTime()) ? null : d;
};

interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

/** Markaya özgü, bağımlılıksız açılır takvim — native `<input type="date">`'in
 *  tarayıcıdan tarayıcıya değişen OS takvim popup'ının yerini alır. */
export const DatePicker = ({ id, value, onChange, ariaLabel, className }: DatePickerProps) => {
  const selected = parseValue(value);
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected ?? new Date()));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const openPicker = () => {
    setViewMonth(startOfMonth(selected ?? new Date()));
    setIsOpen(true);
  };

  const handleSelect = (day: Date) => {
    onChange(format(day, VALUE_FORMAT));
    setIsOpen(false);
  };

  const days: Date[] = [];
  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <button
        id={id}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className="text-[11px] text-text-heading bg-transparent outline-none border-none cursor-pointer font-medium rounded focus-visible:ring-2 focus-visible:ring-executive-blue"
      >
        {selected ? format(selected, 'd MMM yyyy', { locale: tr }) : '—'}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="dialog"
            aria-label={ariaLabel}
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380 }}
            className="absolute z-50 top-[calc(100%+8px)] left-0 w-64 p-3 rounded-2xl bg-surface-elevated backdrop-blur-xl border border-surface-border shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)]"
          >
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewMonth(m => subMonths(m, 1))}
                aria-label="Önceki ay"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-medium text-text-heading uppercase tracking-widest font-serif">
                {format(viewMonth, 'LLLL yyyy', { locale: tr })}
              </span>
              <button
                type="button"
                onClick={() => setViewMonth(m => addMonths(m, 1))}
                aria-label="Sonraki ay"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAY_LABELS.map(d => (
                <span key={d} className="text-[8px] text-text-tertiary uppercase tracking-widest text-center py-1">
                  {d}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {days.map(day => {
                const isSelected = !!selected && isSameDay(day, selected);
                const inMonth = isSameMonth(day, viewMonth);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => handleSelect(day)}
                    aria-current={isToday(day) ? 'date' : undefined}
                    aria-pressed={isSelected}
                    className={cn(
                      'w-7 h-7 flex items-center justify-center rounded-lg text-[10px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue',
                      isSelected
                        ? 'bg-executive-blue text-white shadow-sm'
                        : inMonth
                          ? 'text-text-heading hover:bg-surface-glass'
                          : 'text-text-tertiary/40 hover:bg-surface-glass',
                      !isSelected && isToday(day) && 'ring-1 ring-executive-blue/40'
                    )}
                  >
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
