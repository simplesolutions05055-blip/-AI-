import type { ProfileGender } from '@/lib/useProfile';

export function genderCopy(
  gender: ProfileGender | null | undefined,
  copy: { male: string; female: string; neutral?: string },
): string {
  if (gender === 'female') return copy.female;
  if (gender === 'male') return copy.male;
  return copy.neutral ?? copy.male;
}
