import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { ReactNode } from 'react';

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function Tooltip({ children, content, side = 'top', align = 'center' }: TooltipProps) {
  if (!content) {
    return <>{children}</>;
  }

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          dir="rtl"
          side={side}
          align={align}
          sideOffset={5}
          className="z-50 rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white shadow-md max-w-[250px] animate-in fade-in-0 zoom-in-95 break-words"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-gray-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
