import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Renders nothing for the first `delay` ms: sub-second loads resolve without a
// spinner flash, which reads as "instant" instead of "something blinked".
export function Spinner({ className = 'h-5 w-5', delay = 400 }: { className?: string; delay?: number }) {
  const [visible, setVisible] = useState(delay <= 0);

  useEffect(() => {
    if (delay <= 0) return;
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  if (!visible) return null;
  return <Loader2 className={`animate-spin ${className}`} />;
}
