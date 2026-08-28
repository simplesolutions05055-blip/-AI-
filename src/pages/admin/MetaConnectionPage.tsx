/**
 * Meta Connection Page - Rebuilt from scratch
 * Single "Connect Meta" button for Facebook + Instagram
 */

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/ui/Spinner';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface MetaUser {
  id: string;
  name: string;
  picture: string | null;
}

interface FacebookPage {
  id: string;
  page_id: string;
  page_name: string;
  page_picture: string | null;
  category: string | null;
}

interface InstagramAccount {
  id: string;
  instagram_id: string;
  username: string;
  profile_picture_url: string | null;
}

interface ConnectionData {
  id: string;
  meta_user_id: string;
  meta_user_name: string;
  meta_user_picture: string | null;
  status: string;
  provider?: 'meta' | 'autopost';
  last_verified_at: string;
  default_facebook_page_id: string | null;
  default_instagram_account_id: string | null;
  meta_facebook_pages: FacebookPage[];
  meta_instagram_accounts: InstagramAccount[];
}

interface AuthUserResponse {
  data: {
    user: {
      id: string;
    } | null;
  };
}

export default function MetaConnectionPage() {
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [data, setData] = useState<ConnectionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [scheduledPosts, setScheduledPosts] = useState<any[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(false);

  // Check for OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const errorParam = urlParams.get('error');
    const autoPostConnected = urlParams.get('autopost') === 'connected';

    if (errorParam) {
      setError(`OAuth error: ${errorParam}`);
      window.history.replaceState({}, '', '/admin/meta-connection');
      return;
    }

    if (autoPostConnected) {
      setSuccess('AutoPost חובר בהצלחה');
      window.history.replaceState({}, '', '/admin/meta-connection');
      loadConnectionData();
    } else if (code) {
      console.log('✅ Authorization code received, exchanging for tokens...');
      exchangeCode(code);
      window.history.replaceState({}, '', '/admin/meta-connection');
    } else {
      loadConnectionData();
    }
  }, []);

  // Load scheduled posts
  const loadScheduledPosts = async () => {
    try {
      setLoadingScheduled(true);
      const supabase = createSupabaseBrowserClient();
      const { data: posts, error } = await supabase
        .from('scheduled_social_posts')
        .select('*')
        .in('platform', ['facebook', 'instagram'])
        .in('status', ['scheduled', 'published', 'failed'])
        .order('scheduled_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      setScheduledPosts(posts || []);
    } catch (err) {
      console.error('Failed to load scheduled posts:', err);
    } finally {
      setLoadingScheduled(false);
    }
  };

  // Poll scheduled posts every 30 seconds when on page
  useEffect(() => {
    if (data) {
      loadScheduledPosts();
      const interval = setInterval(loadScheduledPosts, 30000);
      return () => clearInterval(interval);
    }
  }, [data]);

  const loadConnectionData = async () => {
    try {
      setLoading(true);
      setError(null);

      const supabase = createSupabaseBrowserClient();
      const authUser = await supabase.auth.getUser() as AuthUserResponse;
      const userId = authUser.data.user?.id;
      if (!userId) {
        setData(null);
        return;
      }

      const { data: connectionData, error: fetchError } = await supabase
        .from('meta_connections')
        .select(`
          id,
          meta_user_id,
          meta_user_name,
          meta_user_picture,
          status,
          last_verified_at,
          default_facebook_page_id,
          default_instagram_account_id,
          meta_facebook_pages!connection_id (
            id,
            page_id,
            page_name,
            page_picture,
            category
          ),
          meta_instagram_accounts!connection_id (
            id,
            instagram_id,
            username,
            profile_picture_url
          )
        `)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        console.error('❌ Error loading connection:', fetchError);
        setError('Failed to load connection data');
        return;
      }

      const typedConnection = connectionData as ConnectionData | null;
      setData(typedConnection);
      
      if (typedConnection) {
        console.log('✅ Connection data loaded:');
        console.log(`- User: ${typedConnection.meta_user_name}`);
        console.log(`- Pages: ${typedConnection.meta_facebook_pages?.length || 0}`);
        console.log(`- Instagram: ${typedConnection.meta_instagram_accounts?.length || 0}`);
      } else {
        console.log('ℹ️ No connection found');
      }
    } catch (err) {
      console.error('❌ Exception loading connection:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const startMetaOAuth = async () => {
    console.log('🔵 Starting Meta OAuth flow...');
    setConnecting(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: invokeError } = await supabase.functions.invoke('autopost-oauth-start', {
        body: {},
      });
      if (invokeError || !data?.url) throw new Error(invokeError?.message || 'AutoPost connection URL missing');
      window.location.href = data.url;
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Failed to connect AutoPost');
      setConnecting(false);
    }
  };

  const exchangeCode = async (code: string) => {
    try {
      setConnecting(true);
      setError(null);
      setSuccess(null);

      console.log('📤 Exchanging authorization code...');

      const supabase = createSupabaseBrowserClient();
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-oauth-callback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.session.access_token}`,
          },
          body: JSON.stringify({ code }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error('❌ Exchange failed:', result);
        throw new Error(result.error || 'Failed to exchange code');
      }

      console.log('✅ Exchange successful:', result);
      setSuccess(`Connected successfully! ${result.pages_count} page(s), ${result.instagram_count} Instagram account(s)`);
      
      // Reload connection data
      await loadConnectionData();
    } catch (err) {
      console.error('❌ Exchange error:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  // Mark one page / Instagram account as the brand's default publish target.
  // Scheduling flows (site modal, WhatsApp bot) pre-select it automatically.
  const setDefaultTarget = async (kind: 'facebook' | 'instagram', rowId: string) => {
    if (!data) return;
    const column = kind === 'facebook' ? 'default_facebook_page_id' : 'default_instagram_account_id';
    try {
      setError(null);
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase
        .from('meta_connections')
        .update({ [column]: rowId } as never)
        .eq('id', data.id);
      if (updateError) throw updateError;
      setData({ ...data, [column]: rowId });
      setSuccess(kind === 'facebook' ? 'עמוד ברירת המחדל עודכן' : 'חשבון ברירת המחדל עודכן');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'עדכון ברירת המחדל נכשל');
    }
  };

  const disconnectMeta = async () => {
    if (!confirm('Are you sure you want to disconnect Meta? This will remove all Facebook and Instagram connections.')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const supabase = createSupabaseBrowserClient();
      const authUser = await supabase.auth.getUser() as AuthUserResponse;
      const userId = authUser.data.user?.id;
      if (!userId) {
        throw new Error('Not authenticated');
      }

      const { error: deleteError } = await supabase
        .from('meta_connections')
        .delete()
        .eq('user_id', userId);

      if (deleteError) {
        throw deleteError;
      }

      console.log('✅ Disconnected successfully');
      setSuccess('Disconnected successfully');
      setData(null);
    } catch (err) {
      console.error('❌ Disconnect error:', err);
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto p-6" dir="rtl">
      <h1 className="mb-6 text-2xl font-bold text-[var(--text-strong)]">חיבור Meta (Facebook & Instagram)</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {!data ? (
        <div className="overflow-hidden rounded-2xl border-[1.5px] border-emerald-500/40 bg-emerald-50/70 shadow-sm">
          {/* Hero: the two networks this connection unlocks. */}
          <div className="px-6 py-12 text-center">
            <div className="mb-5 flex items-center justify-center gap-3">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#1877f2] text-white shadow-sm">
                <FacebookGlyph />
              </span>
              <span className="h-px w-8 bg-emerald-500/30" />
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white shadow-sm">
                <InstagramGlyph />
              </span>
            </div>
            <h2 className="mb-2 text-2xl font-bold text-[var(--text-strong)]">חברו את הפייסבוק והאינסטגרם שלכם</h2>
            <p className="mx-auto max-w-md text-sm leading-6 text-[var(--muted)]">
              חיבור אחד מאפשר לתזמן ולפרסם ישירות לעמודי הפייסבוק ולחשבונות האינסטגרם שלכם.
            </p>
            <button
              onClick={startMetaOAuth}
              disabled={connecting}
              className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand px-8 text-base font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {connecting && <Spinner className="w-4 h-4" />}
              התחבר ל-Meta
            </button>
          </div>

        </div>
      ) : (
        <div className="space-y-5">
          {/* Connected account header */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
            <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border-soft)] bg-[var(--surface-2)] px-6 py-5">
              {data.meta_user_picture ? (
                <img
                  src={data.meta_user_picture}
                  alt={data.meta_user_name}
                  className="h-14 w-14 rounded-full object-cover ring-2 ring-white"
                />
              ) : (
                <span className="grid h-14 w-14 place-items-center rounded-full bg-[#1877f2] text-white">
                  <FacebookGlyph />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-lg font-semibold text-[var(--text-strong)]">{data.meta_user_name}</p>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    מחובר
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  אומת לאחרונה: {new Date(data.last_verified_at).toLocaleString('he-IL')}
                </p>
              </div>
              <button
                onClick={disconnectMeta}
                className="shrink-0 rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
              >
                נתק חיבור
              </button>
            </div>

            {/* Facebook Pages */}
            <section className="px-6 py-5">
              <header className="mb-4 flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1877f2] text-white">
                  <FacebookGlyph className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold text-[var(--text-strong)]">עמודי Facebook</h2>
                <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]">
                  {data.meta_facebook_pages?.length || 0}
                </span>
              </header>
              {data.meta_facebook_pages && data.meta_facebook_pages.length > 0 ? (
                <div className="space-y-2.5">
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    עמוד ברירת המחדל נבחר אוטומטית בכל תזמון פרסום (באתר ובוואטסאפ). אפשר להחליף עמוד בכל תזמון בנפרד.
                  </p>
                  {data.meta_facebook_pages.map((page) => {
                    const isDefault = data.default_facebook_page_id
                      ? data.default_facebook_page_id === page.id
                      : data.meta_facebook_pages.length === 1;
                    return (
                      <div
                        key={page.id}
                        className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                          isDefault
                            ? 'border-emerald-500/40 bg-emerald-50/60'
                            : 'border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--border-warm)]'
                        }`}
                      >
                        {page.page_picture ? (
                          <img src={page.page_picture} alt={page.page_name} className="h-11 w-11 rounded-lg object-cover" />
                        ) : (
                          <span className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--muted)]">
                            <FacebookGlyph className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-[var(--text-strong)]">{page.page_name}</p>
                          {page.category && <p className="truncate text-sm text-[var(--muted)]">{page.category}</p>}
                        </div>
                        {isDefault ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            ברירת מחדל
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDefaultTarget('facebook', page.id)}
                            className="shrink-0 rounded-lg border border-[var(--border-warm)] px-3 py-1.5 text-xs font-semibold text-[var(--text-strong)] transition hover:bg-[var(--surface-2)]"
                          >
                            קבע כברירת מחדל
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-[var(--border-warm)] p-4 text-center text-sm text-[var(--muted)]">
                  לא נמצאו עמודים
                </p>
              )}
            </section>

            {/* Instagram Accounts */}
            <section className="border-t border-[var(--border-soft)] px-6 py-5">
              <header className="mb-4 flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white">
                  <InstagramGlyph className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold text-[var(--text-strong)]">חשבונות Instagram Business</h2>
                <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]">
                  {data.meta_instagram_accounts?.length || 0}
                </span>
              </header>
              {data.meta_instagram_accounts && data.meta_instagram_accounts.length > 0 ? (
                <div className="space-y-2.5">
                  {data.meta_instagram_accounts.map((ig) => {
                    const isDefault = data.default_instagram_account_id
                      ? data.default_instagram_account_id === ig.id
                      : data.meta_instagram_accounts.length === 1;
                    return (
                      <div
                        key={ig.id}
                        className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                          isDefault
                            ? 'border-emerald-500/40 bg-emerald-50/60'
                            : 'border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--border-warm)]'
                        }`}
                      >
                        {ig.profile_picture_url ? (
                          <img src={ig.profile_picture_url} alt={ig.username} className="h-11 w-11 rounded-full object-cover" />
                        ) : (
                          <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--muted)]">
                            <InstagramGlyph className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-[var(--text-strong)]">@{ig.username}</p>
                        </div>
                        {isDefault ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            ברירת מחדל
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDefaultTarget('instagram', ig.id)}
                            className="shrink-0 rounded-lg border border-[var(--border-warm)] px-3 py-1.5 text-xs font-semibold text-[var(--text-strong)] transition hover:bg-[var(--surface-2)]"
                          >
                            קבע כברירת מחדל
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-[var(--border-warm)] p-4 text-center text-sm text-[var(--muted)]">
                  לא נמצאו חשבונות Instagram Business
                </p>
              )}
            </section>
          </div>
          {/* Scheduled Posts Viewer */}
          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-6 shadow-sm">
            <h2 className="mb-4 flex items-center justify-between text-base font-semibold text-[var(--text-strong)]">
              <span>פרסומים מתוזמנים</span>
              <button
                onClick={loadScheduledPosts}
                disabled={loadingScheduled}
                className="text-sm text-brand hover:text-brand-dark"
              >
                {loadingScheduled ? '⟳ טוען...' : '🔄 רענן'}
              </button>
            </h2>
            
            {scheduledPosts.length === 0 ? (
              <p className="text-gray-500 text-center py-4">אין פרסומים מתוזמנים</p>
            ) : (
              <div className="space-y-3">
                {scheduledPosts.map((post) => (
                  <div
                    key={post.id}
                    className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span>{post.platform === 'facebook' ? '📘' : '📸'}</span>
                        <span className="font-medium">{post.target_name || post.target_platform_id}</span>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          post.status === 'scheduled'
                            ? 'bg-blue-100 text-blue-800'
                            : post.status === 'published'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {post.status === 'scheduled' ? '⏳ ממתין' : post.status === 'published' ? '✅ פורסם' : '❌ נכשל'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mb-2 line-clamp-2">
                      {post.caption}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>📅 {new Date(post.scheduled_at).toLocaleString('he-IL')}</span>
                      {post.external_post_id && (
                        <span>🆔 {post.external_post_id}</span>
                      )}
                    </div>
                    {post.error_message && (
                      <p className="text-xs text-red-600 mt-2">❌ {post.error_message}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// Meta's brand marks — lucide dropped its brand icons, so they live here.
function FacebookGlyph({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.3-1.5 1.6-1.5h1.7V4.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.3V14h2.8v8h3.4Z" />
    </svg>
  );
}

function InstagramGlyph({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
