import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface OnboardingState {
  details_done?: boolean;
  brand_done?: boolean;
  docs_done?: boolean;
  files_done?: boolean;
  hard_completed_at?: string | null;
  banner_dismissed_at?: string | null;
}

export type ProfileGender = 'male' | 'female';

export interface Profile {
  id: string;
  email: string;
  role: 'admin' | 'user';
  can_create_outputs: boolean;
  full_name: string | null;
  phone: string | null;
  job_title: string | null;
  gender: ProfileGender | null;
  avatar_path: string | null;
  onboarding: OnboardingState;
  /** Per-user override of the global output_permissions setting; null = inherit. */
  output_permissions: unknown;
  /** Per-user calendar-month production caps by group; {} = none. */
  monthly_limits: unknown;
}

export interface ProfileState {
  loading: boolean;
  profile: Profile | null;
  /** Whether the user has at least one assigned brand (gates onboarding steps 2–3). */
  hasBrand: boolean;
  /**
   * Whether the assigned brand is usable: it has a logo and at least one
   * Business Brain content source. An admin can provision a user + empty brand
   * shell in one step, so `onboarding.brand_done` is not proof of this.
   * Always true for admins (they are not gated on it).
   */
  brandReady: boolean;
  /** Global admin setting: are the document/file upload steps mandatory? */
  requireUploads: boolean;
}

const PROFILE_COLUMNS =
  'id, email, role, can_create_outputs, full_name, phone, job_title, gender, avatar_path, onboarding, output_permissions, monthly_limits';

/** Loads the signed-in user's profile, brand membership, and the onboarding policy. */
export function useProfile(): ProfileState {
  const [state, setState] = useState<ProfileState>({
    loading: true,
    profile: null,
    hasBrand: false,
    brandReady: false,
    requireUploads: false,
  });

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let active = true;

    (async () => {
      const { data: auth } = await db.auth.getUser();
      const user = auth.user;
      if (!user) {
        if (active) setState({ loading: false, profile: null, hasBrand: false, brandReady: false, requireUploads: false });
        return;
      }

      const [{ data }, { data: brandRows }, { data: setting }] = await Promise.all([
        db.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle(),
        db.from('user_brands').select('brand_id').eq('user_id', user.id),
        db.from('settings').select('value_json').eq('key', 'onboarding_require_uploads').maybeSingle(),
      ]);

      if (!active) return;

      const brandIds = ((brandRows as { brand_id: string }[] | null) ?? []).map((r) => r.brand_id);
      const hasBrand = brandIds.length > 0;
      const isAdmin = (data as { role?: string } | null)?.role === 'admin';
      let brandReady = isAdmin;
      if (hasBrand && !isAdmin) {
        // An admin-provisioned brand shell carries only a name. A brand someone
        // actually set up — through onboarding or the branding screen — has a
        // logo. That is the readiness signal.
        const { data: brand } = await db
          .from('brands')
          .select('logo_path')
          .in('id', brandIds)
          .limit(1)
          .maybeSingle();
        brandReady = !!(brand as { logo_path?: string | null } | null)?.logo_path;
      }
      if (!active) return;
      const profile: Profile = data
        ? ({ ...(data as unknown as Profile), onboarding: (data as { onboarding?: OnboardingState }).onboarding ?? {} })
        : {
            id: user.id,
            email: user.email ?? '',
            role: 'user',
            can_create_outputs: false,
            full_name: null,
            phone: null,
            job_title: null,
            gender: null,
            avatar_path: null,
            onboarding: {},
            output_permissions: null,
            monthly_limits: {},
          };

      setState({
        loading: false,
        profile,
        hasBrand,
        brandReady,
        requireUploads: ((setting as { value_json?: unknown } | null)?.value_json as boolean | undefined) === true,
      });
    })();

    return () => {
      active = false;
    };
  }, []);

  return state;
}
