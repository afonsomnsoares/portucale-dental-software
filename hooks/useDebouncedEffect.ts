'use client';
import { useEffect, useRef } from 'react';

export function useDebouncedEffect(effect: () => void | (() => void), deps: unknown[], delay = 300) {
  const cleanupRef = useRef<void | (() => void)>(undefined);

  useEffect(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
    }
    const t = setTimeout(() => {
      cleanupRef.current = effect();
    }, delay);
    return () => {
      clearTimeout(t);
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: caller controls deps
  }, deps);
}
