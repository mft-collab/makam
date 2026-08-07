import React from 'react';
import { Modal } from './ui/Modal';
import { ShieldCheck, Smartphone, Zap, Layout } from 'lucide-react';
import { Logo } from './Logo';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal = ({ isOpen, onClose }: AboutModalProps) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="md">
      <div className="flex flex-col items-center justify-center text-center p-2 gap-6">
        <Logo size="xl" withText={false} variant="dark" />
        
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-serif text-text-heading tracking-tight">MAKAM Stratejik Yönetim</h2>
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="text-[10px] uppercase tracking-[0.22em] text-executive-gold font-medium">Sürüm v2.1.0</span>
            <span className="text-[10px] text-text-muted">•</span>
            <span className="text-[9px] uppercase tracking-widest text-emerald-500 font-medium">Lisanslı Sürüm</span>
          </div>
        </div>

        <p className="text-[13px] text-text-muted leading-relaxed max-w-sm">
          Bu dizge, stratejik verileri minimum gecikme ve maksimum güvenlikle işlemek üzere tasarlanmış <strong className="text-text-heading font-medium">dünya standartlarında</strong> bir mimari üzerine inşa edilmiştir.
        </p>

        <div className="w-full bg-surface-glass rounded-2xl border border-surface-border p-5 mt-2">
          <ul className="text-left flex flex-col gap-4">
            <li className="flex items-center gap-3 text-[12px] text-text-heading">
              <Zap className="w-4 h-4 text-emerald-500 shrink-0" />
              <span><strong className="font-medium">Çevrimdışı Öncelikli Motor:</strong> Zustand & IndexedDB</span>
            </li>
            <li className="flex items-center gap-3 text-[12px] text-text-heading">
              <Layout className="w-4 h-4 text-blue-500 shrink-0" />
              <span><strong className="font-medium">Sessiz Lüks Arayüz:</strong> Dinamik Gece Teması & Framer Motion</span>
            </li>
            <li className="flex items-center gap-3 text-[12px] text-text-heading">
              <ShieldCheck className="w-4 h-4 text-purple-500 shrink-0" />
              <span><strong className="font-medium">Kalite Güvence:</strong> Playwright E2E Otomasyonu</span>
            </li>
            <li className="flex items-center gap-3 text-[12px] text-text-heading">
              <Smartphone className="w-4 h-4 text-amber-500 shrink-0" />
              <span><strong className="font-medium">Çoklu Platform:</strong> PWA Destekli Adaptif Mimari</span>
            </li>
          </ul>
        </div>

        <div className="text-[10px] text-text-tertiary mt-2 uppercase tracking-widest font-light">
          © {new Date().getFullYear()} MAKAM. Yasal Hak Sahibi: <a href="mailto:muftum@gmail.com" className="text-executive-gold font-medium hover:underline">muftum@gmail.com</a>
        </div>
      </div>
    </Modal>
  );
};
