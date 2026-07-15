import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ScheduledPost {
  id: string;
  connection_id: string;
  platform: 'facebook' | 'instagram';
  target_platform_id: string;
  target_name: string;
  caption: string;
  image_url: string | null;
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
      .select('id, connection_id, platform, target_platform_id, target_name, caption, image_url')
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

        // Call post-to-meta Edge Function
        const postUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/post-to-meta`;
        const postResponse = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            user_id: connection.user_id,
            platform: post.platform,
            target_id: post.target_platform_id,
            message: post.caption,
            image_url: post.image_url,
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
