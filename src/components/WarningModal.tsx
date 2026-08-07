import React, { useRef } from 'react';
import { Task, User } from '../types';
import { AlertTriangle, X, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useModalBehavior } from './ui/Modal';

interface WarningModalProps {
  task: Task;
  assignee: User | undefined;
  onClose: () => void;
}

export const WarningModal = ({ task, assignee, onClose }: WarningModalProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Ortak modal davranışı: Escape ile kapatma, focus-trap, body scroll kilidi,
  // açılışta kapat butonuna odaklanma (ui/Modal ile paylaşılan stack mantığı)
  useModalBehavior({ isOpen: true, onClose, containerRef: panelRef, initialFocusRef: closeButtonRef });

  return (
    <div
      className="fixed inset-0 bg-executive-blue/60 backdrop-blur-md flex items-center justify-center p-8 z-[200]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="warning-modal-title"
    >
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl bg-surface-elevated p-6 md:p-10 rounded-2xl relative border-[8px] md:border-[10px] border-red-500/10 shadow-[0_40px_90px_-24px_rgba(239,68,68,0.14)] overflow-y-auto overflow-x-hidden max-h-[90vh] custom-scrollbar"
      >
        {/* Decorative Background Patterns */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/5 rounded-full blur-[80px] -mr-32 -mt-32" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-slate-500/5 rounded-full blur-[80px] -ml-32 -mb-32" />

        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="İkaz belgesini kapat"
          className="absolute top-8 right-8 text-text-muted/40 hover:text-red-500 transition-colors rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          <X className="w-8 h-8 stroke-[1.2]" aria-hidden="true" />
        </button>

        <div className="flex flex-col items-center text-center gap-4 md:gap-6 relative z-10">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 shadow-inner shrink-0">
            <AlertTriangle className="w-8 h-8 md:w-10 md:h-10 stroke-[1.2]" aria-hidden="true" />
          </div>

          <div className="flex flex-col gap-2 md:gap-3">
            <h2 id="warning-modal-title" className="text-2xl md:text-3xl font-light text-text-heading tracking-[0.3em] font-serif uppercase">İkaz ve Uyarı Belgesi</h2>
            <div className="flex items-center justify-center gap-3 md:gap-4">
              <div className="h-[1px] w-12 bg-red-500/30" />
              <span className="text-[10px] text-red-500 font-medium tracking-[0.3em] uppercase">Makam Disiplin Bildirimi</span>
              <div className="h-[1px] w-12 bg-red-500/30" />
            </div>
          </div>

          <div className="w-full border-y border-red-500/10 py-6 md:py-8 flex flex-col gap-3 md:gap-4">
            <p className="text-[14px] md:text-[16px] text-text-muted font-light font-serif">İlgili Personel,</p>
            <p className="text-2xl md:text-4xl font-light text-text-heading tracking-tight font-serif border-b-2 border-red-500/10 pb-3 md:pb-4 w-fit mx-auto">
              {assignee?.fullName || 'İlgili Personel'}
            </p>
            <div className="flex flex-col gap-4 text-[14px] md:text-[15px] text-text-muted leading-relaxed max-w-lg mx-auto font-light text-left">
              <p>
                Tarafınıza verilen <span className="text-text-heading font-normal not-italic px-2 bg-red-500/5 rounded-lg border border-red-500/10 whitespace-nowrap">"{task.title}"</span> kodlu operasyonel sürecin, belirlenen süre içerisinde tamamlanamadığı görülmüştür. Kurum içi işleyiş ve hizmet standartları gereği bu durum, mevcut iş takip süreçlerimize bir bildirim olarak kaydedilmiştir.
              </p>
              <p>
                Gelecekteki planlamaların aksamaması için süreçlerin zamanında tamamlanmasına özen gösterilmesini rica eder, iyi çalışmalar dilerim.
              </p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between w-full px-4 md:px-12 pt-4 gap-8 md:gap-0">
             <div className="flex flex-col items-center md:items-start gap-2">
                <span className="text-[10px] text-text-muted font-medium uppercase tracking-[0.3em]">TEBLİĞ TARİHİ</span>
                <span className="text-[14px] text-text-heading font-light font-serif">{new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
             </div>
             <div className="flex flex-col items-center gap-3 shrink-0">
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full border border-red-500/20 flex items-center justify-center relative">
                   <ShieldAlert className="w-8 h-8 md:w-10 md:h-10 text-red-500/30 stroke-[1]" aria-hidden="true" />
                   <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 md:w-16 md:h-16 border border-dashed border-red-500/20 rounded-full animate-[spin_20s_linear_infinite]" />
                   </div>
                </div>
                <span className="text-[10px] text-red-500 font-medium uppercase tracking-[0.3em]">RESMİ MÜHÜR</span>
             </div>
             <div className="flex flex-col items-center md:items-end gap-2">
                <span className="text-[10px] text-text-muted font-medium uppercase tracking-[0.3em]">ONAY MAKAMI</span>
                <span className="text-[14px] text-text-heading font-light font-serif">Stratejik Denetim Kurulu</span>
             </div>
          </div>

          <button
            onClick={onClose}
            className="mt-4 md:mt-6 px-10 md:px-12 h-12 md:h-14 tracking-[0.3em] bg-red-500/10 text-red-500 border border-red-500/20 rounded-full text-[10px] md:text-[11px] font-medium uppercase hover:bg-red-500/90 hover:text-white transition-all duration-300 w-full md:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            DİZGEYE DÖN
          </button>
        </div>
      </motion.div>
    </div>
  );
};
