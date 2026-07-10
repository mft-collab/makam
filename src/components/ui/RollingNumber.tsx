import React, { useEffect, useState } from 'react';
import { useSpring, useTransform } from 'motion/react';

interface RollingNumberProps {
  value: number;
  className?: string;
}

export const RollingNumber = ({ value, className }: RollingNumberProps) => {
  const spring = useSpring(value, {
    mass: 1,
    stiffness: 80,
    damping: 15,
  });

  const displayValue = useTransform(spring, (latest) => Math.round(latest));
  const [current, setCurrent] = useState(value);

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  useEffect(() => {
    return displayValue.on('change', (latest) => {
      setCurrent(latest);
    });
  }, [displayValue]);

  return <span className={className}>{current}</span>;
};
