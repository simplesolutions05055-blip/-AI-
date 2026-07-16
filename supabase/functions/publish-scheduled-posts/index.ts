import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify cron secret for security
    const cronSecret = req.headers.get('x-cron-secret');
    if (cronSecret !== CRON_SECRET) {
      return json({ error: 'unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Find all scheduled posts that are due (scheduled_at <= now)
    const now = new Date().toISOString();

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
      return json({ processed: 0, published: 0, failed: 0 });
    }

    const results: PublishResult[] = [];

    // Process each post
    for (const post of duePosts as ScheduledPost[]) {
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

    return json({
      processed: results.length,
      published,
      failed,
      results,
    });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});

// Turn a post's media records into public-fetchable image URLs for the Graph
// API. Stored media lives in the private 'outputs' bucket, so each image gets
// a signed URL (Meta fetches it within seconds; 6h leaves ample slack).
// Video is not supported by the auto-publisher yet — better to fail loudly
// than to silently publish a partial post.
async function resolveImageUrls(
  supabase: ReturnType<typeof createClient>,
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
