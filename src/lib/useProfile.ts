import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface OnboardingState {
  details_done?: boolean;
  docs_done?: boolean;
  files_done?: boolean;
  hard_completed_at?: string | null;
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
}

export interface ProfileState {
  loading: boolean;
  profile: Profile | null;
  /** Whether the user has at least one assigned brand (gates onboarding steps 2–3). */
  hasBrand: boolean;
  /** Global admin setting: are the document/file upload steps mandatory? */
  requireUploads: boolean;
}

const PROFILE_COLUMNS =
  'id, email, role, can_create_outputs, full_name, phone, job_title, gender, avatar_path, onboarding';

/** Loads the signed-in user's profile, brand membership, and the onboarding policy. */
export function useProfile(): ProfileState {
  const [state, setState] = useState<ProfileState>({
    loading: true,
    profile: null,
    hasBrand: false,
    requireUploads: false,
  });

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let active = true;

    (async () => {
      const { data: auth } = await db.auth.getUser();
      const user = auth.user;
      if (!user) {
        if (active) setState({ loading: false, profile: null, hasBrand: false, requireUploads: false });
        return;
      }

      const [{ data }, { count }, { data: setting }] = await Promise.all([
        db.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle(),
        db.from('user_brands').select('brand_id', { count: 'exact', head: true }).eq('user_id', user.id),
        db.from('settings').select('value_json').eq('key', 'onboarding_require_uploads').maybeSingle(),
      ]);

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
          };

      setState({
        loading: false,
        profile,
        hasBrand: (count ?? 0) > 0,
        requireUploads: ((setting as { value_json?: unknown } | null)?.value_json as boolean | undefined) === true,
      });
    })();

    return () => {
      active = false;
    };
  }, []);

  return state;
}
