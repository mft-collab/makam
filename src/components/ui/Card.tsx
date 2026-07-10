import React from 'react';
import { cn } from '../../lib/utils';

import { motion, useMotionTemplate, useMotionValue } from 'motion/react';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  spotlight?: boolean;
}

export const Card = ({ title, description, footer, children, className, spotlight = true, ...props }: CardProps) => {
  // HTML drag/animation event handler'ları motion.div'in kendi prop'larıyla çakıştığı için
  // bilinçli olarak ayıklanıyor (restProps'a sızmamaları gerekiyor) — silme, davranışı bozar.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onAnimationStart, onDrag, onDragStart, onDragEnd, ...restProps } = props as any;
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function handleMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  const background = useMotionTemplate`
    radial-gradient(
      800px circle at ${mouseX}px ${mouseY}px,
      rgba(100, 116, 139, 0.04),
      transparent 80%
    )
  `;

  return (
    <motion.div 
      layout
      className={cn(
        'makam-card flex flex-col gap-5 group/card', 
        spotlight && 'makam-card-spotlight',
        className
      )} 
      onMouseMove={handleMouseMove}
      style={{
        '--mouse-x': useMotionTemplate`${mouseX}px`,
        '--mouse-y': useMotionTemplate`${mouseY}px`,
      } as any}
      {...restProps}
    >
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition duration-300 group-hover/card:opacity-100"
        style={{ background }}
      />
      {(title || description) && (
        <div className="flex flex-col gap-1 relative z-10">
          {title && <h3 className="text-[17px] font-semibold text-text-heading tracking-tight">{title}</h3>}
          {description && <p className="text-[13px] font-medium text-text-muted leading-tight">{description}</p>}
        </div>
      )}
      <div className="flex-1 relative z-10">{children}</div>
      {footer && <div className="pt-5 mt-auto border-t border-surface-border relative z-10">{footer}</div>}
    </motion.div>
  );
};
