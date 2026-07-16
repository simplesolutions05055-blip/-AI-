/**
 * Post to Meta (Facebook & Instagram) - Immediate Publishing
 * Posts content immediately to selected Facebook Pages or Instagram accounts.
 *
 * Supports:
 * - Facebook: text-only feed post, single real photo post, multi-photo post
 *   (unpublished photos attached to one feed post).
 * - Instagram: single image, or a 2-10 image carousel.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FacebookPage {
  id: string;
  page_id: string;
  page_name: string;
  page_access_token: string;
}

interface InstagramAccount {
  id: string;
  instagram_id: string;
  username: string;
  linked_page_id: string;
}

interface PostRequest {
  platform: 'facebook' | 'instagram';
  target_id: string; // page_id for Facebook, instagram_id for Instagram
  message: string;
  image_url?: string; // single image (back-compat)
  image_urls?: string[]; // multiple images — carousel/multi-photo
  connection_id?: string; // preferred connection lookup (worker calls)
}

interface PostResult {
  success: boolean;
  platform: string;
  target_name: string;
  post_id?: string;
  error?: string;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    // Check if service_role (for worker) or user JWT
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

    let userId: string | null = null;

    if (isServiceRole) {
      // Worker call - identified by connection_id or user_id from the body
      const bodyPeek = await req.clone().json();
      userId = bodyPeek.user_id ?? null;
      if (!userId && !bodyPeek.connection_id) {
        throw new Error('connection_id or user_id required for service_role calls');
      }
    } else {
      // User call - authenticate via JWT
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      if (userError || !user) {
        throw new Error('Unauthorized');
      }
      userId = user.id;
    }

    // Create service_role client for database queries
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey
    );

    // Parse request body
    const body = await req.json() as PostRequest;
    const { platform, target_id, message } = body;
    // Normalized image list: image_urls wins, image_url is the single-image
    // back-compat field.
    const imageUrls = (body.image_urls ?? (body.image_url ? [body.image_url] : []))
      .filter((u) => typeof u === 'string' && u.length > 0)
      .slice(0, 10);

    if (!platform || !target_id || !message) {
      throw new Error('Missing required fields: platform, target_id, message');
    }

    // Get the Meta connection: by id when the worker pins one, else the
    // caller's own active connection.
    let connectionQuery = supabaseAdmin
      .from('meta_connections')
      .select(`
        id,
        meta_user_id,
        status,
        meta_facebook_pages (
          id,
          page_id,
          page_name,
          page_access_token
        ),
        meta_instagram_accounts (
          id,
          instagram_id,
          username,
          linked_page_id
        )
      `)
      .eq('status', 'active');
    connectionQuery = body.connection_id
      ? connectionQuery.eq('id', body.connection_id)
      : connectionQuery.eq('user_id', userId!);

    const { data: connections, error: fetchError } = await connectionQuery
      .order('updated_at', { ascending: false })
      .limit(1);

    if (fetchError) {
      throw new Error('Failed to fetch Meta connection');
    }

    const connectionData = connections?.[0] ?? null;
    if (!connectionData) {
      throw new Error('No active Meta connection found');
    }

    // When a user (not the worker) posts on a pinned connection, make sure the
    // connection is actually theirs — the admin RLS-free client would otherwise
    // let any caller publish through any connection id.
    if (!isServiceRole && body.connection_id) {
      const { data: owned } = await supabaseAdmin
        .from('meta_connections')
        .select('user_id')
        .eq('id', body.connection_id)
        .maybeSingle();
      if (owned?.user_id !== userId) {
        throw new Error('Connection does not belong to caller');
      }
    }

    let result: PostResult;

    if (platform === 'facebook') {
      const pages = connectionData.meta_facebook_pages as FacebookPage[];
      const targetPage = pages.find(p => p.page_id === target_id);

      if (!targetPage) {
        throw new Error(`Facebook Page ${target_id} not found in connection`);
      }

      result = await postToFacebook(targetPage, message, imageUrls);
    } else if (platform === 'instagram') {
      const instagramAccounts = connectionData.meta_instagram_accounts as InstagramAccount[];
      const targetAccount = instagramAccounts.find(ig => ig.instagram_id === target_id);

      if (!targetAccount) {
        throw new Error(`Instagram account ${target_id} not found in connection`);
      }

      // Get the linked Facebook Page's access token
      const pages = connectionData.meta_facebook_pages as FacebookPage[];
      const linkedPage = pages.find(p => String(p.id) === String(targetAccount.linked_page_id));

      if (!linkedPage) {
        throw new Error(`Linked Facebook Page not found for Instagram account ${targetAccount.username}`);
      }

      if (imageUrls.length === 0) {
        throw new Error('פרסום ב-Instagram חייב לכלול קישור לתמונה. Instagram אינו תומך בפוסטים עם טקסט בלבד.');
      }

      result = await postToInstagram(targetAccount, linkedPage, message, imageUrls);
    } else {
      throw new Error(`Invalid platform: ${platform}`);
    }

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// ============================================================================
// Facebook
// ============================================================================

async function postToFacebook(
  page: FacebookPage,
  message: string,
  imageUrls: string[],
): Promise<PostResult> {
  const fail = (error: string): PostResult => ({
    success: false, platform: 'facebook', target_name: page.page_name, error,
  });
  const ok = (postId?: string): PostResult => ({
    success: true, platform: 'facebook', target_name: page.page_name, post_id: postId,
  });

  // Text-only post
  if (imageUrls.length === 0) {
    const data = await graphPost(`${page.page_id}/feed`, {
      message,
      access_token: page.page_access_token,
    });
    if (data.error) return fail(data.error.message || 'Failed to post to Facebook');
    return ok(data.id);
  }

  // Single photo post — a real photo (not a link preview)
  if (imageUrls.length === 1) {
    const data = await graphPost(`${page.page_id}/photos`, {
      url: imageUrls[0],
      message,
      access_token: page.page_access_token,
    });
    if (data.error) return fail(data.error.message || 'Failed to post photo to Facebook');
    return ok(data.post_id || data.id);
  }

  // Multi-photo post: upload each photo unpublished, then attach all to one
  // feed post.
  const mediaIds: string[] = [];
  for (const url of imageUrls) {
    const data = await graphPost(`${page.page_id}/photos`, {
      url,
      published: 'false',
      access_token: page.page_access_token,
    });
    if (data.error || !data.id) {
      return fail(data.error?.message || 'Failed to upload photo to Facebook');
    }
    mediaIds.push(data.id);
  }

  const feedBody: Record<string, string> = {
    message,
    access_token: page.page_access_token,
  };
  mediaIds.forEach((id, i) => {
    feedBody[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const data = await graphPost(`${page.page_id}/feed`, feedBody);
  if (data.error) return fail(data.error.message || 'Failed to publish multi-photo post');
  return ok(data.id);
}

// ============================================================================
// Instagram
// ============================================================================

async function postToInstagram(
  account: InstagramAccount,
  linkedPage: FacebookPage,
  caption: string,
  imageUrls: string[],
): Promise<PostResult> {
  const targetName = `@${account.username}`;
  const token = linkedPage.page_access_token;
  const fail = (error: string): PostResult => ({
    success: false, platform: 'instagram', target_name: targetName, error,
  });

  let creationId: string;

  if (imageUrls.length === 1) {
    // Single image: one container with the caption.
    const container = await graphPost(`${account.instagram_id}/media`, {
      image_url: imageUrls[0],
      caption,
      access_token: token,
    });
    if (container.error || !container.id) {
      return fail(container.error?.message || 'Failed to create Instagram media container');
    }
    creationId = container.id;
  } else {
    // Carousel: a child container per image, then a carousel container that
    // references them and carries the caption.
    const children: string[] = [];
    for (const url of imageUrls) {
      const child = await graphPost(`${account.instagram_id}/media`, {
        image_url: url,
        is_carousel_item: 'true',
        access_token: token,
      });
      if (child.error || !child.id) {
        return fail(child.error?.message || 'Failed to create Instagram carousel item');
      }
      children.push(child.id);
    }

    // Children must finish processing before the carousel container accepts them.
    for (const childId of children) {
      const ready = await waitForContainer(childId, token);
      if (!ready.ok) return fail(ready.error);
    }

    const carousel = await graphPost(`${account.instagram_id}/media`, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
      access_token: token,
    });
    if (carousel.error || !carousel.id) {
      return fail(carousel.error?.message || 'Failed to create Instagram carousel container');
    }
    creationId = carousel.id;
  }

  const ready = await waitForContainer(creationId, token);
  if (!ready.ok) return fail(ready.error);

  const publishData = await graphPost(`${account.instagram_id}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  });
  if (publishData.error || !publishData.id) {
    return fail(publishData.error?.message || 'Failed to publish to Instagram');
  }

  return {
    success: true,
    platform: 'instagram',
    target_name: targetName,
    post_id: publishData.id,
  };
}

// Poll an Instagram container until Meta reports it FINISHED. Image containers
// are usually ready immediately; the retry loop covers slower processing
// without letting one post hang the worker.
async function waitForContainer(
  containerId: string,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`
    );
    const data = await res.json();
    const status = data.status_code as string | undefined;
    if (status === 'FINISHED') return { ok: true };
    if (status === 'ERROR' || data.error) {
      return { ok: false, error: data.error?.message || 'Instagram media container failed processing' };
    }
    // IN_PROGRESS (or missing status): wait and retry.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { ok: false, error: 'Instagram media container timed out during processing' };
}

// ============================================================================
// Graph API helper
// ============================================================================

// deno-lint-ignore no-explicit-any
async function graphPost(path: string, body: Record<string, string>): Promise<any> {
  const response = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  try {
    return await response.json();
  } catch {
    return { error: { message: `Graph API returned ${response.status}` } };
  }
}
