import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, Home, ShieldAlert } from 'lucide-react';
import { Logo } from './Logo';
import { logError } from '../services/errorLoggingService';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Konsola yaz (geliştirme ortamı)
    console.error('[ErrorBoundary] Uncaught error:', error);
    // Firestore'a yapılandırılmış log yaz (üretim gözlemlenebilirliği)
    logError(error, 'ErrorBoundary', {
      context: {
        componentStack: errorInfo.componentStack?.slice(0, 1000),
      },
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      let errorMessage = 'Beklenmedik bir operasyonel hata oluştu.';
      let isFirebaseError = false;

      try {
        const parsedError = JSON.parse(this.state.error?.message || '');
        if (parsedError.error && parsedError.operationType) {
          errorMessage = `Veritabanı erişim protokolü ihlali: ${parsedError.operationType} işlemi sırasında yetki kısıtlaması tespit edildi.`;
          isFirebaseError = true;
        }
      } catch {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-surface-base flex items-center justify-center p-8 font-sans">
          <div className="max-w-lg w-full makam-card !p-12 flex flex-col items-center text-center gap-10 bg-makam-glass border-surface-border shadow-2xl backdrop-blur-[40px]">
            <Logo size="lg" withText={false} />
            
            <div className="w-20 h-20 bg-status-danger/10 text-status-danger rounded-2xl flex items-center justify-center border border-status-danger/20 shadow-inner">
              <ShieldAlert className="w-10 h-10 stroke-[1.2]" />
            </div>
            
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-light text-text-heading tracking-tight font-serif uppercase">Dizge Kesintisi</h2>
              <p className="text-text-muted text-[15px] font-light leading-relaxed">
                {errorMessage}
              </p>
              {isFirebaseError && (
                <div className="inline-flex mx-auto mt-4 px-6 py-2 bg-status-danger/10 border border-status-danger/20 rounded-full">
                  <p className="text-[10px] text-status-danger font-medium uppercase tracking-[0.16em]">
                    Yetki Doğrulama Hatası (RBAC Protocol)
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 w-full pt-8 border-t border-makam-border/5">
              <button 
                onClick={this.handleReset} 
                className="makam-button-primary w-full h-16 tracking-[0.16em]"
              >
                <RefreshCw className="w-5 h-5 mr-3 stroke-[1.5]" />
                DİZGEYİ YENİLE
              </button>
              <button 
                onClick={() => window.location.href = '/'} 
                className="makam-button-secondary w-full h-16 tracking-[0.16em]"
              >
                <Home className="w-5 h-5 mr-3 stroke-[1.5]" />
                ANA SAYFAYA DÖN
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
