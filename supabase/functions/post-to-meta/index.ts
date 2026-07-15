/**
 * Post to Meta (Facebook & Instagram) - Immediate Publishing
 * Posts content immediately to selected Facebook Pages or Instagram accounts
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

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
  image_url?: string; // Optional image URL
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
    
    let userId: string;
    
    if (isServiceRole) {
      // Worker call - get user_id from request body
      const bodyPeek = await req.clone().json();
      userId = bodyPeek.user_id;
      if (!userId) {
        throw new Error('user_id required for service_role calls');
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
    const { platform, target_id, message, image_url } = body;

    if (!platform || !target_id || !message) {
      throw new Error('Missing required fields: platform, target_id, message');
    }

    // Get user's Meta connection
    const { data: connectionData, error: fetchError} = await supabaseAdmin
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
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (fetchError) {
      throw new Error('Failed to fetch Meta connection');
    }

    if (!connectionData) {
      throw new Error('No active Meta connection found');
    }

    let result: PostResult;

    // ========================================
    // POST TO FACEBOOK PAGE
    // ========================================
    if (platform === 'facebook') {
      const pages = connectionData.meta_facebook_pages as FacebookPage[];
      const targetPage = pages.find(p => p.page_id === target_id);

      if (!targetPage) {
        throw new Error(`Facebook Page ${target_id} not found in connection`);
      }

      const postUrl = `https://graph.facebook.com/v21.0/${targetPage.page_id}/feed`;
      
      const postBody: Record<string, string> = {
        message: message,
        access_token: targetPage.page_access_token,
      };

      // Add image if provided
      if (image_url) {
        postBody.link = image_url;
      }

      const response = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        result = {
          success: false,
          platform: 'facebook',
          target_name: targetPage.page_name,
          error: data.error?.message || 'Failed to post to Facebook',
        };
      } else {
        result = {
          success: true,
          platform: 'facebook',
          target_name: targetPage.page_name,
          post_id: data.id,
        };
      }
    }
    // ========================================
    // POST TO INSTAGRAM
    // ========================================
    else if (platform === 'instagram') {
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

      if (!image_url) {
        throw new Error('פרסום ב-Instagram חייב לכלול קישור לתמונה. Instagram אינו תומך בפוסטים עם טקסט בלבד.');
      }

      // Instagram posting is a 2-step process:
      // 1. Create container (media object)
      // 2. Publish container

      // Step 1: Create container
      const containerUrl = `https://graph.facebook.com/v21.0/${targetAccount.instagram_id}/media`;
      const containerBody = {
        image_url: image_url,
        caption: message,
        access_token: linkedPage.page_access_token,
      };

      const containerResponse = await fetch(containerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerBody),
      });

      const containerData = await containerResponse.json();

      if (!containerResponse.ok || containerData.error) {
        result = {
          success: false,
          platform: 'instagram',
          target_name: `@${targetAccount.username}`,
          error: containerData.error?.message || 'Failed to create Instagram media container',
        };
      } else {
        const containerId = containerData.id;

        // Step 2: Publish container
        const publishUrl = `https://graph.facebook.com/v21.0/${targetAccount.instagram_id}/media_publish`;
        const publishBody = {
          creation_id: containerId,
          access_token: linkedPage.page_access_token,
        };

        const publishResponse = await fetch(publishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(publishBody),
        });

        const publishData = await publishResponse.json();

        if (!publishResponse.ok || publishData.error) {
          result = {
            success: false,
            platform: 'instagram',
            target_name: `@${targetAccount.username}`,
            error: publishData.error?.message || 'Failed to publish to Instagram',
          };
        } else {
          result = {
            success: true,
            platform: 'instagram',
            target_name: `@${targetAccount.username}`,
            post_id: publishData.id,
          };
        }
      }
    } else {
      throw new Error(`Invalid platform: ${platform}`);
    }

    // ========================================
    // RETURN RESULT
    // ========================================
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
