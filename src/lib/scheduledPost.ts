// Shared shape + labels for a scheduled social post, used by the calendar,
// the annual planner and the scheduled-post editor page.
import type { StoredMediaRecord } from '@/components/SocialScheduleSection';

export type ScheduledSocialPost = {
  id: string;
  brand_id: string | null;
  request_id: string | null;
  title: string | null;
  platform: 'facebook' | 'instagram';
  caption: string;
  scheduled_at: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'cancelled';
  media?: StoredMediaRecord[] | null;
  connection_id?: string | null;
  target_platform_id?: string | null;
  target_name?: string | null;
  brands?: { name?: string | null } | null;
};

export const SCHEDULED_POST_COLUMNS =
  'id, brand_id, request_id, title, platform, caption, scheduled_at, status, media, connection_id, target_platform_id, target_name, brands(name)';

// Publishing is manual for now (no Meta connection), so a scheduled post whose
// time has passed needs a human: highlight it and offer copy/download/mark-done.
export function isDueForPublish(post: ScheduledSocialPost) {
  return post.status === 'scheduled' && new Date(post.scheduled_at).getTime() <= Date.now();
}

export function scheduleStatusLabel(post: ScheduledSocialPost) {
  if (post.status === 'draft') return 'טיוטה — לא מפורסם';
  if (post.status === 'published') return 'פורסם';
  if (post.status === 'failed') return 'נכשל';
  if (post.status === 'cancelled') return 'בוטל';
  return isDueForPublish(post) ? 'ממתין לפרסום ידני' : 'מתוזמן';
}

export function scheduleTone(post: ScheduledSocialPost) {
  if (post.status === 'draft') return 'border-amber-300 bg-amber-50 text-amber-800';
  if (post.status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (post.status === 'published') return 'border-[#10b981] bg-[#ecfdf5] text-[#065f46]';
  if (post.platform === 'facebook') return 'border-[#60a5fa] bg-[#eff6ff] text-[#1d4ed8]';
  return 'border-[#f472b6] bg-[#fdf2f8] text-[#9d174d]';
}

export function timeLabel(value: string) {
  return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function scheduleLabel(post: ScheduledSocialPost) {
  return `${timeLabel(post.scheduled_at)} ${schedulePlatformLabel(post)}`;
}

export function scheduleDisplayTitle(post: ScheduledSocialPost) {
  return post.title?.trim() || scheduleLabel(post);
}

export function schedulePlatformLabel(post: ScheduledSocialPost) {
  return post.platform === 'facebook' ? 'פייסבוק' : 'אינסטגרם';
}

export function schedulePlatformMark(post: ScheduledSocialPost) {
  return post.platform === 'facebook' ? 'f' : '◎';
}

export function datetimeLocalFromIso(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Where the editor page lives for a given post. Posts produced from a request
// keep the revision page (image/deck tools included); standalone ones get the
// same page without the output-editing half.
export function scheduledPostPath(post: { id: string; request_id: string | null }) {
  return post.request_id
    ? `/admin/files/${post.request_id}/revise?post=${post.id}`
    : `/admin/schedule/${post.id}`;
}
