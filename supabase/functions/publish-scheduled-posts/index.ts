import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { cors } from '../_shared/cors.ts';
import { checkCanary, matchesEnvSecret } from '../_shared/secrets.ts';
import { db } from '../_shared/db.ts';

interface StoredMediaRecord {
  kind: 'image' | 'video';
  source: 'upload' | 'output';
  name: string;
  storage_path: string | null;
  mime_type: string | null;
}

interface ScheduledPost {
  id: string;
  connection_id: string;
  platform: 'facebook' | 'instagram';
  target_platform_id: string;
  target_name: string;
  caption: string;
  image_url: string | null;
  media: StoredMediaRecord[] | null;
}

interface PublishResult {
  id: string;
  success: boolean;
  post_id?: string;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req, 'POST', ['x-cron-secret']) });
  }

  try {
    // Verify cron secret. Compared in constant time so the rejection latency
    // cannot be used to recover the secret one character at a time; a canary
    // hit answers IDENTICALLY so the trap is never revealed to the caller.
    const cronSecret = req.headers.get('x-cron-secret');
    if (await checkCanary(db(), req, cronSecret, 'publish-scheduled-posts')) {
      return json(req, { error: 'unauthorized' }, 401);
    }
    if (!(await matchesEnvSecret('CRON_SECRET', cronSecret))) {
      return json(req, { error: 'unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Find all scheduled posts that are due (scheduled_at <= now)
    const now = new Date().toISOString();

    // Proactively expire Meta connections whose token has lapsed. The per-post
    // check below already refuses a non-active connection, but flipping the
    // status here is what surfaces the problem in the UI (banner + errors page)
    // before the client notices posts silently failing.
    const { data: lapsed } = await supabase
      .from('meta_connections')
      .update({ status: 'expired', error_message: 'טוקן פייסבוק פג תוקף — יש להתחבר מחדש', updated_at: now })
      .eq('status', 'active')
      .not('token_expires_at', 'is', null)
      .lt('token_expires_at', now)
      .select('id, brand_id');
    for (const c of lapsed ?? []) {
      await supabase.from('logs').insert({
        severity: 'warning',
        action: 'meta_connection_expired',
        message: 'חיבור פייסבוק פג תוקף — פוסטים מתוזמנים ייכשלו עד חיבור מחדש',
        metadata: { connection_id: (c as { id: string }).id, brand_id: (c as { brand_id: string | null }).brand_id },
      });
    }

    const { data: duePosts, error: queryError } = await supabase
      .from('scheduled_social_posts')
      .select('id, connection_id, platform, target_platform_id, target_name, caption, image_url, media')
      .eq('status', 'scheduled')
      .in('platform', ['facebook', 'instagram'])
      .lte('scheduled_at', now)
      .limit(50); // Process up to 50 posts per run

    if (queryError) {
      throw queryError;
    }

    if (!duePosts || duePosts.length === 0) {
      return json(req, { processed: 0, published: 0, failed: 0 });
    }

    const results: PublishResult[] = [];

    // Process each post
    for (const post of duePosts as ScheduledPost[]) {
      // Claim the post before doing any work: flip 'scheduled' -> 'publishing'
      // conditionally. If another (overlapping or previous slow) run already
      // took it, this update hits zero rows and we skip — no double publish.
      const { data: claimed } = await supabase
        .from('scheduled_social_posts')
        .update({ status: 'publishing', updated_at: new Date().toISOString() })
        .eq('id', post.id)
        .eq('status', 'scheduled')
        .select('id');
      if (!claimed || claimed.length === 0) continue;

      try {
        // Verify connection is still active
        const { data: connection, error: connError } = await supabase
          .from('meta_connections')
          .select('status, access_token, user_id')
          .eq('id', post.connection_id)
          .single();

        if (connError || !connection) {
          throw new Error('Meta connection not found');
        }

        if (connection.status !== 'active') {
          throw new Error(`Meta connection is ${connection.status}`);
        }

        // Build the list of publishable image URLs: sign every stored media
        // image from the outputs bucket (in the user's chosen order), falling
        // back to the direct image_url field for posts scheduled with one.
        const imageUrls = await resolveImageUrls(supabase, post);

        // Call post-to-meta Edge Function
        const postUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/post-to-meta`;
        const postResponse = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            connection_id: post.connection_id,
            user_id: connection.user_id,
            platform: post.platform,
            target_id: post.target_platform_id,
            message: post.caption,
            image_urls: imageUrls,
          }),
        });

        const postResult = await postResponse.json();

        if (postResult.success) {
          // Update status to published
          await supabase
            .from('scheduled_social_posts')
            .update({
              status: 'published',
              external_post_id: postResult.post_id || null,
              error_message: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', post.id);

          results.push({ id: post.id, success: true, post_id: postResult.post_id });
        } else {
          throw new Error(postResult.error || 'Unknown error from post-to-meta');
        }
      } catch (error) {
        const errorMessage = String(error);

        // Update status to failed
        await supabase
          .from('scheduled_social_posts')
          .update({
            status: 'failed',
            error_message: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', post.id);

        results.push({ id: post.id, success: false, error: errorMessage });
      }
    }

    // Summary
    const published = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return json(req, {
      processed: results.length,
      published,
      failed,
      results,
    });
  } catch (error) {
    return json(req, { error: String(error) }, 500);
  }
});

// Turn a post's media records into public-fetchable image URLs for the Graph
// API. Stored media lives in the private 'outputs' bucket, so each image gets
// a signed URL (Meta fetches it within seconds; 6h leaves ample slack).
// Video is not supported by the auto-publisher yet — better to fail loudly
// than to silently publish a partial post.
async function resolveImageUrls(
  supabase: SupabaseClient<any, 'public', any>,
  post: ScheduledPost,
): Promise<string[]> {
  const media = Array.isArray(post.media) ? post.media : [];

  if (media.some((m) => m?.kind === 'video')) {
    throw new Error('פרסום וידאו אוטומטי עדיין לא נתמך — פרסמו את הפוסט הזה ידנית');
  }

  const urls: string[] = [];
  for (const item of media) {
    if (item?.kind !== 'image' || !item.storage_path) continue;
    const { data: signed, error } = await supabase.storage
      .from('outputs')
      .createSignedUrl(item.storage_path, 6 * 60 * 60);
    if (error || !signed?.signedUrl) {
      throw new Error(`Failed to sign media URL for ${item.storage_path}`);
    }
    urls.push(signed.signedUrl);
  }

  if (urls.length === 0 && post.image_url) {
    urls.push(post.image_url);
  }

  return urls.slice(0, 10);
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST', ['x-cron-secret']), 'Content-Type': 'application/json' },
  });
}
