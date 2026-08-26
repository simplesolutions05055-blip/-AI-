import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { logError } from '@/lib/errorReporting';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      text: 'signin_with' | 'signup_with';
      shape: 'rectangular';
      logo_alignment: 'left';
      width: number;
      locale: string;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GOOGLE_SCRIPT_ID = 'google-identity-services';
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleAuthButtonProps {
  mode: 'login' | 'signup';
  onSuccess: () => void;
  onError: (message: string) => void;
}

export default function GoogleAuthButton({ mode, onSuccess, onError }: GoogleAuthButtonProps) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

    function renderGoogleButton() {
      if (!active || !buttonRef.current || !window.google) return;

      buttonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async ({ credential }) => {
          if (!credential) {
            onError('Google לא החזיר פרטי התחברות. נסו שוב.');
            return;
          }

          setLoading(true);
          try {
            const supabase = createSupabaseBrowserClient();
            const { error } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: credential,
            });
            if (error) throw error;
            onSuccess();
          } catch (error) {
            void logError('google_auth_failed', error);
            onError('הכניסה עם Google נכשלה. נסו שוב.');
          } finally {
            if (active) setLoading(false);
          }
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: mode === 'signup' ? 'signup_with' : 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: Math.min(buttonRef.current.clientWidth || 336, 400),
        locale: 'he',
      });
      setLoading(false);
    }

    async function initialize() {
      if (!googleClientId) {
        try {
          const supabase = createSupabaseBrowserClient();
          const { data, error } = await supabase.functions.invoke('google-auth-config');
          if (error) throw error;
          googleClientId = (data as { client_id?: string } | null)?.client_id ?? '';
        } catch (error) {
          void logError('google_auth_config_failed', error);
        }
      }

      if (!active) return;
      if (!googleClientId) {
        setLoading(false);
        onError('הכניסה עם Google אינה מוגדרת כרגע.');
        return;
      }

      const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
      if (window.google) {
        renderGoogleButton();
      } else if (existing) {
        existing.addEventListener('load', renderGoogleButton, { once: true });
      } else {
        const script = document.createElement('script');
        script.id = GOOGLE_SCRIPT_ID;
        script.src = GOOGLE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = renderGoogleButton;
        script.onerror = () => {
          if (!active) return;
          setLoading(false);
          onError('טעינת Google נכשלה. בדקו את החיבור ונסו שוב.');
        };
        document.head.appendChild(script);
      }
    }

    void initialize();

    return () => {
      active = false;
      document.getElementById(GOOGLE_SCRIPT_ID)?.removeEventListener('load', renderGoogleButton);
    };
  }, [mode, onError, onSuccess]);

  return (
    <div className="relative min-h-10 w-full" aria-busy={loading}>
      <div ref={buttonRef} className="flex w-full justify-center" />
      {loading && (
        <div className="absolute inset-0 grid place-items-center rounded-lg border border-[var(--border)] bg-white text-sm text-[var(--muted)]">
          טוען Google...
        </div>
      )}
    </div>
  );
}
