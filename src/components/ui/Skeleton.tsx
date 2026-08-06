/**
 * Skeleton — Yükleme iskelet animasyonu
 * 
 * Gerçek içerik yüklenene kadar gösterilen pulsing placeholder'lar.
 * Kullanıcıya içeriğin yüklenmekte olduğunu hissettirerek
 * algılanan performansı iyileştirir (no-CLS, layout stable).
 */
import React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
  /** Yuvarlak mi (avatar gibi) yoksa dikdörtgen mi? */
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

export const Skeleton = ({ className, style, rounded = 'md' }: SkeletonProps) => {
  const roundedMap = {
    none: 'rounded-none',
    sm:   'rounded-lg',
    md:   'rounded-xl',
    lg:   'rounded-2xl',
    full: 'rounded-full',
  };

  return (
    <div
      className={cn(
        'bg-gradient-to-r from-text-heading/[0.04] via-text-heading/[0.08] to-text-heading/[0.04]',
        'bg-[length:200%_100%] animate-skeleton',
        roundedMap[rounded],
        className
      )}
      style={style}
      aria-hidden="true"
      role="presentation"
    />
  );
};

/**
 * TaskCardSkeleton — Görev kartı yükleme iskeleti
 */
export const TaskCardSkeleton = () => (
  <div className="makam-card p-5 flex flex-col gap-4">
    <div className="flex items-start justify-between">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-6 w-16" rounded="full" />
    </div>
    <Skeleton className="h-3 w-1/2" />
    <div className="flex items-center gap-2 mt-1">
      <Skeleton className="h-7 w-7" rounded="full" />
      <Skeleton className="h-3 w-24" />
    </div>
    <div className="flex items-center gap-2 pt-2 border-t border-executive-blue/[0.04]">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-20" />
    </div>
  </div>
);

/**
 * TableRowSkeleton — Tablo satırı yükleme iskeleti
 */
export const TableRowSkeleton = ({ cols = 5 }: { cols?: number }) => (
  <div className="flex items-center gap-4 px-5 py-4 border-b border-executive-blue/[0.03]">
    {Array.from({ length: cols }).map((_, i) => (
      <Skeleton
        key={i}
        className="h-3 flex-1"
        style={{ maxWidth: i === 0 ? '200px' : i === cols - 1 ? '60px' : '120px' } as React.CSSProperties}
      />
    ))}
  </div>
);

/**
 * DashboardSkeleton — Dashboard tam sayfa yükleme iskeleti
 */
export const DashboardSkeleton = () => (
  <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto" aria-label="Yükleniyor..." role="status">
    {/* KPI kartları */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="makam-card p-5 flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-2 w-full" rounded="full" />
        </div>
      ))}
    </div>
    {/* Büyük kart */}
    <div className="makam-card p-6 flex flex-col gap-4">
      <Skeleton className="h-4 w-40" />
      {[...Array(5)].map((_, i) => (
        <TableRowSkeleton key={i} />
      ))}
    </div>
  </div>
);
