import type { RequestStatus, OutputType } from '@/types/db';

export const STATUS_LABEL: Record<RequestStatus, string> = {
  received: 'התקבלה',
  collecting_details: 'איסוף פרטים',
  queued: 'בתור',
  processing: 'בעיבוד',
  quality_check: 'בדיקת QA',
  waiting_for_approval: 'ממתין לאישור',
  approved: 'אושר',
  rejected: 'נדחה',
  regenerating: 'יצירה מחדש',
  sending: 'בשליחה',
  sent: 'נשלח',
  needs_attention: 'דורש טיפול',
  failed: 'נכשל',
  closed: 'סגור',
};

export const STATUS_COLOR: Record<RequestStatus, string> = {
  received: 'bg-gray-100 text-gray-700',
  collecting_details: 'bg-blue-50 text-blue-700',
  queued: 'bg-blue-50 text-blue-700',
  processing: 'bg-amber-50 text-amber-700',
  quality_check: 'bg-amber-50 text-amber-700',
  waiting_for_approval: 'bg-purple-50 text-purple-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
  regenerating: 'bg-amber-50 text-amber-700',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-green-100 text-green-800',
  needs_attention: 'bg-orange-50 text-orange-700',
  failed: 'bg-red-100 text-red-800',
  closed: 'bg-gray-100 text-gray-500',
};

export const OUTPUT_LABEL: Record<OutputType, string> = {
  text: 'טקסט',
  image: 'תמונה',
  pdf: 'מסמך',
  presentation: 'מצגת',
};

// Human-readable Hebrew name for a conversation's source. WhatsApp chats keep
// their phone number; internal sources (the production form, the simulator)
// get a friendly Hebrew label instead of their raw English identifier.
export function senderLabel(whatsappFrom: string | null | undefined): string {
  if (!whatsappFrom) return '-';
  const clean = whatsappFrom.replace('whatsapp:', '');
  if (clean === 'production-form') return 'טופס הפקה';
  if (clean === 'simulator') return 'סימולטור';
  return clean;
}
