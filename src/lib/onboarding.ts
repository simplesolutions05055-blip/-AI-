import type { Profile } from '@/lib/useProfile';

// Onboarding gating, shared by AdminLayout (entry gate + banner) and the
// onboarding screen. Admins are exempt from onboarding entirely.

/** Must the user finish onboarding before reaching the app? */
export function needsOnboardingGate(
  profile: Profile,
  hasBrand: boolean,
  requireUploads: boolean,
): boolean {
  if (profile.role === 'admin') return false;
  const ob = profile.onboarding ?? {};
  if (!ob.details_done) return true; // user details are always mandatory
  if (!hasBrand || !ob.brand_done) return true; // brand assignment is now self-service but mandatory
  if (requireUploads && hasBrand && (!ob.docs_done || !ob.files_done)) return true;
  return false;
}

/** Has the user completed every applicable step (no reminder needed)? */
export function isOnboardingComplete(profile: Profile, hasBrand: boolean): boolean {
  const ob = profile.onboarding ?? {};
  if (!ob.details_done) return false;
  if (!hasBrand || !ob.brand_done) return false;
  if (!ob.docs_done || !ob.files_done) return false;
  return true;
}

/** Show the top reminder banner: entered the app but optional steps remain. */
export function shouldShowOnboardingBanner(
  profile: Profile,
  hasBrand: boolean,
  requireUploads: boolean,
): boolean {
  if (profile.role === 'admin') return false;
  if (profile.onboarding?.banner_dismissed_at) return false;
  return (
    !needsOnboardingGate(profile, hasBrand, requireUploads) &&
    !isOnboardingComplete(profile, hasBrand)
  );
}
