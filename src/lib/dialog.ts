// Promise-based replacement for the browser's native alert()/confirm(). A single
// <DialogHost/> (mounted in App) subscribes to this queue and renders an RTL modal,
// so every call site gets a right-to-left, brand-styled dialog instead of the
// untranslated, left-to-right native popup.

export interface DialogRequest {
  id: number;
  variant: 'alert' | 'confirm';
  title?: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

type Listener = (requests: DialogRequest[]) => void;

let queue: DialogRequest[] = [];
let listeners: Listener[] = [];
let counter = 0;

function emit() {
  const snapshot = [...queue];
  for (const listener of listeners) listener(snapshot);
}

export function subscribeDialogs(listener: Listener): () => void {
  listeners.push(listener);
  listener([...queue]);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function resolveDialog(id: number, value: boolean) {
  const request = queue.find((r) => r.id === id);
  if (!request) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  request.resolve(value);
}

interface AlertOptions {
  title?: string;
  message: string;
  confirmText?: string;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export function alertDialog(input: string | AlertOptions): Promise<void> {
  const opts = typeof input === 'string' ? { message: input } : input;
  return new Promise<void>((resolve) => {
    queue = [
      ...queue,
      {
        id: ++counter,
        variant: 'alert',
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText ?? 'אישור',
        resolve: () => resolve(),
      },
    ];
    emit();
  });
}

export function confirmDialog(input: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof input === 'string' ? { message: input } : input;
  return new Promise<boolean>((resolve) => {
    queue = [
      ...queue,
      {
        id: ++counter,
        variant: 'confirm',
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText ?? 'אישור',
        cancelText: opts.cancelText ?? 'ביטול',
        danger: opts.danger,
        resolve,
      },
    ];
    emit();
  });
}
