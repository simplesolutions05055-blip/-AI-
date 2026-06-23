import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface Profile {
  id: string;
  email: string;
  role: 'admin' | 'user';
  can_create_outputs: boolean;
}

export interface ProfileState {
  loading: boolean;
  profile: Profile | null;
}

/** Loads the signed-in user's profile (role + permissions). null when signed out. */
export function useProfile(): ProfileState {
  const [state, setState] = useState<ProfileState>({ loading: true, profile: null });

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let active = true;

    (async () => {
      const { data: auth } = await db.auth.getUser();
      const user = auth.user;
      if (!user) {
        if (active) setState({ loading: false, profile: null });
        return;
      }
      const { data } = await db
        .from('profiles')
        .select('id, email, role, can_create_outputs')
        .eq('id', user.id)
        .maybeSingle();

      if (!active) return;
      setState({
        loading: false,
        profile: data
          ? (data as unknown as Profile)
          : { id: user.id, email: user.email ?? '', role: 'user', can_create_outputs: false },
      });
    })();

    return () => {
      active = false;
    };
  }, []);

  return state;
}
