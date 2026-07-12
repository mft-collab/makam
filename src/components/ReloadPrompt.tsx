import { useRegisterSW } from 'virtual:pwa-register/react'
import { motion, AnimatePresence } from 'motion/react'
import { RefreshCw, X } from 'lucide-react'
import { logger } from '../lib/logger'

export function ReloadPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      logger.debug('SW Registered: ' + r)
    },
    onRegisterError(error) {
      logger.error('SW registration error', error)
    },
  })

  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <AnimatePresence>
      {(offlineReady || needRefresh) && (
        <motion.div 
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          className="fixed bottom-6 right-6 z-[100] max-w-[400px]"
        >
          <div className="bg-surface-elevated rounded-2xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.12)] border border-gray-100 flex flex-col gap-4">
             <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                      <RefreshCw className="w-5 h-5 text-blue-600 animate-spin-slow" />
                   </div>
                   <div className="flex flex-col">
                      <h4 className="text-[15px] font-semibold text-text-heading tracking-tight">
                        {offlineReady ? 'Çevrimdışı Hazır' : 'Sistem Güncellemesi'}
                      </h4>
                      <p className="text-[13px] text-text-muted font-medium">
                        {offlineReady 
                          ? 'Uygulama artık internet olmadan çalışabilir.' 
                          : 'Sistem için yeni bir güncelleme mevcut.'}
                      </p>
                   </div>
                </div>
                <button onClick={close} aria-label="Kapat" className="p-1 hover:bg-surface-border/40 rounded-lg transition-colors">
                   <X className="w-4 h-4 text-text-muted" />
                </button>
             </div>
             
             {needRefresh && (
                 <button 
                   onClick={() => updateServiceWorker(true)}
                   className="w-full h-11 bg-[#C5A059] text-white rounded-xl text-[13px] font-semibold uppercase tracking-widest hover:bg-[#B38F46] transition-all shadow-lg shadow-[#C5A059]/20 active:scale-95"
                 >
                 Güncelle ve Yeniden Başlat
               </button>
             )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
