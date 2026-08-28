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

  // Test posting state
  const [posting, setPosting] = useState(false);
  const [postPlatform, setPostPlatform] = useState<'facebook' | 'instagram'>('facebook');
  const [postTarget, setPostTarget] = useState('');
  const [postMessage, setPostMessage] = useState('');
  const [postImageUrl, setPostImageUrl] = useState('');
  const [postResult, setPostResult] = useState<string | null>(null);
  
  // Scheduling state
  const [postMode, setPostMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
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

  const testPost = async () => {
    if (!postTarget || !postMessage) {
      setPostResult('❌ אנא מלא את כל השדות הנדרשים');
      return;
    }

    if (postPlatform === 'instagram' && !postImageUrl) {
      setPostResult('❌ פרסום באינסטגרם דורש תמונה');
      return;
    }

    // Validate scheduling
    if (postMode === 'scheduled') {
      if (!scheduledDate || !scheduledTime) {
        setPostResult('❌ אנא בחר תאריך ושעה לפרסום');
        return;
      }
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
      const minTime = Date.now() + 5 * 60 * 1000; // 5 minutes from now
      if (scheduledDateTime.getTime() < minTime) {
        setPostResult('❌ הפרסום חייב להיות לפחות 5 דקות מהעכשיו');
        return;
      }
    }

    try {
      setPosting(true);
      setPostResult(null);
      setError(null);

      const supabase = createSupabaseBrowserClient();
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        throw new Error('Not authenticated');
      }

      if (postMode === 'now') {
        // Immediate posting
        console.log('📤 Posting now...');
        const requestBody = {
          platform: postPlatform,
          target_id: postTarget,
          message: postMessage,
          ...(postImageUrl && { image_url: postImageUrl }),
        };

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/post-to-meta`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.session.access_token}`,
            },
            body: JSON.stringify(requestBody),
          }
        );

        const result = await response.json();

        if (result.success) {
          console.log('✅ Post successful:', result);
          setPostResult(`✅ פורסם בהצלחה! Post ID: ${result.post_id}`);
          setSuccess(`פורסם ב-${result.target_name}`);
          // Clear form
          setPostMessage('');
          setPostImageUrl('');
        } else {
          console.error('❌ Post failed:', result);
          setPostResult(`❌ ${result.error || 'פרסום נכשל'}`);
        }
      } else {
        // Scheduled posting
        console.log('📅 Scheduling post...');
        const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
        
        // Get connection_id and target_name from current data
        const targetName = postPlatform === 'facebook'
          ? data?.meta_facebook_pages?.find(p => p.page_id === postTarget)?.page_name
          : data?.meta_instagram_accounts?.find(ig => ig.instagram_id === postTarget)?.username;

        const requestBody = {
          platform: postPlatform,
          caption: postMessage,
          scheduled_at: scheduledDateTime.toISOString(),
          connection_id: data?.id,
          target_platform_id: postTarget,
          target_name: targetName || postTarget,
          image_url: postImageUrl || null,
          brand_id: null,
          title: `${postPlatform} post`,
        };

        console.log('Request body:', { ...requestBody, connection_id: requestBody.connection_id ? '[SET]' : '[NULL]' });

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/schedule-social-post`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.session.access_token}`,
            },
            body: JSON.stringify(requestBody),
          }
        );

        const result = await response.json();

        if (result.ok) {
          console.log('✅ Post scheduled:', result);
          setPostResult(`✅ הפרסום תוזמן ל-${scheduledDate} ${scheduledTime}`);
          setSuccess('הפרסום נשמר בהצלחה');
          // Clear form
          setPostMessage('');
          setPostImageUrl('');
          setScheduledDate('');
          setScheduledTime('');
          // Reload scheduled posts
          loadScheduledPosts();
        } else {
          console.error('❌ Scheduling failed:', result);
          const errorMsg = typeof result.error === 'string' 
            ? result.error 
            : JSON.stringify(result.error) || JSON.stringify(result);
          console.error('Error details:', errorMsg);
          setPostResult(`❌ ${errorMsg}`);
        }
      }
    } catch (err) {
      console.error('❌ Post error:', err);
      setPostResult(`❌ ${err instanceof Error ? err.message : 'שגיאה בפרסום'}`);
    } finally {
      setPosting(false);
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
        <div className="space-y-6">
          {/* Facebook User */}
          <div className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">פרופיל Facebook</h2>
            <div className="flex items-center gap-4">
              {data.meta_user_picture && (
                <img
                  src={data.meta_user_picture}
                  alt={data.meta_user_name}
                  className="w-16 h-16 rounded-full"
                />
              )}
              <div>
                <p className="font-medium">{data.meta_user_name}</p>
                <p className="text-sm text-gray-500">ID: {data.meta_user_id}</p>
                <p className="text-sm text-gray-500">
                  אומת לאחרונה: {new Date(data.last_verified_at).toLocaleString('he-IL')}
                </p>
              </div>
            </div>
          </div>

          {/* Facebook Pages */}
          <div className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">
              עמודי Facebook ({data.meta_facebook_pages?.length || 0})
            </h2>
            {data.meta_facebook_pages && data.meta_facebook_pages.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">
                  עמוד ברירת המחדל נבחר אוטומטית בכל תזמון פרסום (באתר ובוואטסאפ). אפשר להחליף עמוד בכל תזמון בנפרד.
                </p>
                {data.meta_facebook_pages.map((page) => {
                  const isDefault = data.default_facebook_page_id
                    ? data.default_facebook_page_id === page.id
                    : data.meta_facebook_pages.length === 1;
                  return (
                    <div key={page.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded">
                      {page.page_picture && (
                        <img
                          src={page.page_picture}
                          alt={page.page_name}
                          className="w-12 h-12 rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{page.page_name}</p>
                        <p className="text-sm text-gray-500">{page.category}</p>
                        <p className="text-xs text-gray-400">ID: {page.page_id}</p>
                      </div>
                      {isDefault ? (
                        <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                          ✓ ברירת מחדל
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDefaultTarget('facebook', page.id)}
                          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                        >
                          קבע כברירת מחדל
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500">לא נמצאו עמודים</p>
            )}
          </div>

          {/* Instagram Accounts */}
          <div className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">
              חשבונות Instagram Business ({data.meta_instagram_accounts?.length || 0})
            </h2>
            {data.meta_instagram_accounts && data.meta_instagram_accounts.length > 0 ? (
              <div className="space-y-3">
                {data.meta_instagram_accounts.map((ig) => {
                  const isDefault = data.default_instagram_account_id
                    ? data.default_instagram_account_id === ig.id
                    : data.meta_instagram_accounts.length === 1;
                  return (
                    <div key={ig.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded">
                      {ig.profile_picture_url && (
                        <img
                          src={ig.profile_picture_url}
                          alt={ig.username}
                          className="w-12 h-12 rounded-full"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">@{ig.username}</p>
                        <p className="text-xs text-gray-400">ID: {ig.instagram_id}</p>
                      </div>
                      {isDefault ? (
                        <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                          ✓ ברירת מחדל
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDefaultTarget('instagram', ig.id)}
                          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                        >
                          קבע כברירת מחדל
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500">לא נמצאו חשבונות Instagram Business</p>
            )}
          </div>

          {/* Test Posting */}
          <div className="border rounded-lg p-6 bg-blue-50">
            <h2 className="text-xl font-semibold mb-4">בדיקת פרסום</h2>
            
            {postResult && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                postResult.startsWith('✅') 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-red-100 text-red-800'
              }`}>
                {postResult}
              </div>
            )}

            <div className="space-y-4">
              {/* Post Mode Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">מצב פרסום</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="postMode"
                      value="now"
                      checked={postMode === 'now'}
                      onChange={() => setPostMode('now')}
                      className="w-4 h-4"
                    />
                    <span>⚡ פרסם עכשיו</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="postMode"
                      value="scheduled"
                      checked={postMode === 'scheduled'}
                      onChange={() => setPostMode('scheduled')}
                      className="w-4 h-4"
                    />
                    <span>📅 תזמן פרסום</span>
                  </label>
                </div>
              </div>

              {/* Scheduling DateTime (only if scheduled mode) */}
              {postMode === 'scheduled' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-2">תאריך</label>
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">שעה</label>
                    <input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    />
                  </div>
                </div>
              )}

              {/* Platform Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">פלטפורמה</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="platform"
                      value="facebook"
                      checked={postPlatform === 'facebook'}
                      onChange={(e) => {
                        setPostPlatform(e.target.value as 'facebook' | 'instagram');
                        setPostTarget('');
                      }}
                      className="w-4 h-4"
                    />
                    <span>📘 Facebook</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="platform"
                      value="instagram"
                      checked={postPlatform === 'instagram'}
                      onChange={(e) => {
                        setPostPlatform(e.target.value as 'facebook' | 'instagram');
                        setPostTarget('');
                      }}
                      className="w-4 h-4"
                    />
                    <span>📸 Instagram</span>
                  </label>
                </div>
              </div>

              {/* Target Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  {postPlatform === 'facebook' ? 'עמוד Facebook' : 'חשבון Instagram'}
                </label>
                <select
                  value={postTarget}
                  onChange={(e) => setPostTarget(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  <option value="">בחר...</option>
                  {postPlatform === 'facebook'
                    ? data.meta_facebook_pages?.map((page) => (
                        <option key={page.page_id} value={page.page_id}>
                          {page.page_name}
                        </option>
                      ))
                    : data.meta_instagram_accounts?.map((ig) => (
                        <option key={ig.instagram_id} value={ig.instagram_id}>
                          @{ig.username}
                        </option>
                      ))}
                </select>
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  הודעה {postPlatform === 'instagram' ? '(כיתוב)' : ''}
                </label>
                <textarea
                  value={postMessage}
                  onChange={(e) => setPostMessage(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="כתוב את ההודעה כאן..."
                />
                <p className="text-xs text-gray-500 mt-1">{postMessage.length} תווים</p>
              </div>

              {/* Image URL (optional for Facebook, required for Instagram) */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  כתובת תמונה (URL) {postPlatform === 'instagram' ? '(חובה)' : '(אופציונלי)'}
                </label>
                <input
                  type="url"
                  value={postImageUrl}
                  onChange={(e) => setPostImageUrl(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="https://example.com/image.jpg"
                />
                {postPlatform === 'instagram' && (
                  <p className="text-xs text-orange-600 mt-1">
                    ⚠️ פרסום באינסטגרם דורש תמונה
                  </p>
                )}
              </div>

              {/* Post Button */}
              <button
                onClick={testPost}
                disabled={
                  posting || 
                  !postTarget || 
                  !postMessage || 
                  (postPlatform === 'instagram' && !postImageUrl) ||
                  (postMode === 'scheduled' && (!scheduledDate || !scheduledTime))
                }
                className="w-full rounded-lg bg-brand hover:bg-brand-dark text-white px-6 py-3 text-base font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {posting && <Spinner className="w-4 h-4" />}
                {posting 
                  ? (postMode === 'now' ? 'מפרסם...' : 'שומר...')
                  : (postMode === 'now' ? 'פרסם עכשיו' : 'תזמן פרסום')
                }
              </button>
            </div>
          </div>

          {/* Scheduled Posts Viewer */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center justify-between">
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

          {/* Disconnect Button */}
          <div className="flex justify-end">
            <button
              onClick={disconnectMeta}
              className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold"
            >
              נתק חיבור
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Meta's brand marks — lucide dropped its brand icons, so they live here.
function FacebookGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.3-1.5 1.6-1.5h1.7V4.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.3V14h2.8v8h3.4Z" />
    </svg>
  );
}

function InstagramGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
