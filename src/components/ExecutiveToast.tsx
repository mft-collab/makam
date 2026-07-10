import React, { useEffect } from 'react';
import { Bell, X, Info, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

export interface ToastData {
  id: string;
  title: string;
  body: string;
  taskId?: string;
  type?: 'info' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
}

interface ExecutiveToastProps {
  toast: ToastData;
  onClose: (id: string) => void;
  onClick: (taskId?: string) => void;
}

export const ExecutiveToast: React.FC<ExecutiveToastProps> = ({ toast, onClose, onClick }) => {
  const handleToastClick = () => {
    if (toast.onClick) {
      toast.onClick();
    } else {
      onClick(toast.taskId);
    }
  };

  useEffect(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
      console.warn('Audio feedback blocked');
    }

    const timer = setTimeout(() => {
      onClose(toast.id);
    }, 6000);

    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  const icons = {
    info: <Info className="h-5 w-5 stroke-[1.2]" />,
    success: <CheckCircle2 className="h-5 w-5 stroke-[1.2]" />,
    warning: <AlertTriangle className="h-5 w-5 stroke-[1.2]" />,
    danger: <AlertCircle className="h-5 w-5 stroke-[1.2]" />,
  };

  const typeStyles = {
    info: "text-executive-blue bg-executive-blue/5 border-executive-blue/10",
    success: "text-emerald-600 bg-emerald-50/50 border-emerald-100/50",
    warning: "text-amber-600 bg-amber-50/50 border-amber-100/50",
    danger: "text-red-600 bg-red-50/50 border-red-100/50",
  };

  return (
    <div 
      role="alert"
      aria-live={toast.type === 'danger' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={cn(
        "pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl shadow-2xl",
        "bg-makam-glass backdrop-blur-[40px] border border-surface-border",
        "transform transition-all duration-700 ease-in-out",
        "animate-in slide-in-from-right-8 fade-in-0",
        "hover:bg-makam-glass cursor-pointer group"
      )}
      onClick={handleToastClick}
    >
      <div className="p-6">
        <div className="flex items-start gap-5">
          <div className="flex-shrink-0" aria-hidden="true">
            <div className={cn(
              "h-10 w-10 rounded-2xl flex items-center justify-center border shadow-inner transition-transform group-hover:rotate-3",
              typeStyles[toast.type || 'info']
            )}>
              {icons[toast.type || 'info']}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-text-heading uppercase tracking-[0.2em] font-serif">
              {toast.title}
            </p>
            <p className="mt-1 text-[13px] font-light text-text-muted leading-relaxed">
              {toast.body}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(toast.id);
            }}
            aria-label="Bildirimi kapat"
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-text-muted/30 hover:text-red-500 hover:bg-red-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <X className="h-5 w-5 stroke-[1.2]" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="h-1 w-full bg-makam-border/5">
        <motion.div 
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: 6, ease: "linear" }}
          className={cn(
            "h-full bg-gradient-to-r",
            toast.type === 'danger' ? "from-red-500 to-red-300" : "from-executive-blue to-executive-gold"
          )}
        />
      </div>
    </div>
  );
};
