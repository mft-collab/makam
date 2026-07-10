import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  layoutId?: string;
}

let modalIdCounter = 0;

export const Modal = ({ isOpen, onClose, title, children, footer, size = 'md', layoutId }: ModalProps) => {
  const [mounted, setMounted] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  // Her modal için benzersiz ID (aria-labelledby için)
  const [modalId] = useState(() => `modal-title-${++modalIdCounter}`);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Modal açıldığında kapat butonuna odaklan
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => closeButtonRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Escape tuşu ile kapat
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();

    // Focus Trap: Tab tuşu modal içinde dolaşır, dışına çıkmaz
    if (e.key === 'Tab' && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Modal açıkken arka planı scroll'dan kilitle
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  const sizes: Record<string, string> = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
    full: 'max-w-[92vw]'
  };

  const content = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalId}
        >
          <div className="flex min-h-full items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={onClose}
              aria-hidden="true"
              className="fixed inset-0 bg-executive-blue/20 backdrop-blur-md -z-10"
            />

            {/* Modal panel */}
            <motion.div
              layoutId={layoutId}
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.98, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 15 }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              className={cn(
                'relative z-10 w-full !p-0 overflow-hidden flex flex-col max-h-[90vh]',
                'shadow-[0_40px_100px_-20px_rgba(0,0,0,0.1)]',
                'bg-surface-elevated backdrop-blur-[40px] border border-surface-border rounded-[40px]',
                sizes[size]
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-makam-border/5 shrink-0">
                <h3
                  id={modalId}
                  className="text-[20px] font-light text-text-heading tracking-tight font-serif uppercase"
                >
                  {title}
                </h3>
                <button
                  ref={closeButtonRef}
                  onClick={onClose}
                  aria-label={`${title} penceresini kapat`}
                  className="w-10 h-10 flex items-center justify-center text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-all rounded-full border border-transparent hover:border-makam-border/10 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
                >
                  <X className="w-5 h-5 stroke-[1.2]" aria-hidden="true" />
                </button>
              </div>

              {/* İçerik */}
              <div className="flex-1 overflow-y-auto p-5 scroll-smooth custom-scrollbar">
                {children}
              </div>

              {footer && (
                <div className="px-8 py-6 border-t border-makam-border/5 bg-surface-border/20/30 shrink-0">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );

  if (!mounted) return null;

  return createPortal(content, document.body);
};
