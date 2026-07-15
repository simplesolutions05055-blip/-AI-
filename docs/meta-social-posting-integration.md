# Meta Social Posting Integration (Facebook & Instagram)

## Overview

This document describes the complete implementation of Facebook and Instagram posting functionality, including OAuth connection, immediate posting, and scheduled posting with automatic publishing.

**Key Features:**
- ✅ Single OAuth connection for both Facebook Pages and Instagram Business accounts
- ✅ Immediate posting to Facebook Pages and Instagram
- ✅ Scheduled posting with automatic publishing via cron worker
- ✅ Post status tracking (scheduled, published, failed)
- ✅ Long-lived access tokens (60-day validity)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [OAuth Connection Flow](#oauth-connection-flow)
3. [Database Schema](#database-schema)
4. [Immediate Posting](#immediate-posting)
5. [Scheduled Posting](#scheduled-posting)
6. [Edge Functions](#edge-functions)
7. [Frontend Implementation](#frontend-implementation)
8. [Configuration](#configuration)
9. [Testing & Debugging](#testing--debugging)

---

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                           │
│                  (MetaConnectionPage.tsx)                       │
│   - OAuth Connect Button                                       │
│   - Post Now / Schedule Toggle                                 │
│   - Scheduled Posts List                                        │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Edge Functions                              │
│                                                                 │
│  1. meta-oauth-callback    → Handle OAuth & store tokens       │
│  2. post-to-meta           → Immediate posting                 │
│  3. schedule-social-post   → Save scheduled posts              │
│  4. publish-scheduled-posts → Worker (called by cron)          │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Database (PostgreSQL)                      │
│                                                                 │
│  - meta_connections        → OAuth tokens & user info          │
│  - meta_facebook_pages     → Linked Facebook Pages             │
│  - meta_instagram_accounts → Linked Instagram Business accounts│
│  - scheduled_social_posts  → Scheduled posts queue             │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cron Job (pg_cron)                           │
│    Runs every minute: triggers publish-scheduled-posts worker  │
└─────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│               Meta Graph API (v21.0)                            │
│   - Facebook Pages API                                          │
│   - Instagram Content Publishing API                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## OAuth Connection Flow

### Meta Business App Configuration

**App Settings:**
- **App ID:** `2793081571067928`
- **App Secret:** `ef826e70dab15b2903ee5edf9005377c`
- **Redirect URI:** `http://localhost:54321/functions/v1/meta-oauth-callback`
- **API Version:** v21.0

**Required Permissions (Scopes):**
- `pages_show_list` - List user's Facebook Pages
- `pages_read_engagement` - Read Page insights
- `pages_manage_posts` - Post to Facebook Pages
- `instagram_basic` - Access Instagram account info
- `instagram_content_publish` - Publish to Instagram
- `business_management` - Access Business accounts

### OAuth Flow Steps

1. **User clicks "Connect Meta" button**
   - Frontend redirects to Meta OAuth URL with required scopes
   - URL: `https://www.facebook.com/v21.0/dialog/oauth?client_id={APP_ID}&redirect_uri={REDIRECT_URI}&scope={SCOPES}`

2. **User authorizes app**
   - Meta shows permission dialog
   - User grants access to Pages and Instagram accounts

3. **Meta redirects to callback with authorization code**
   - URL: `http://localhost:54321/functions/v1/meta-oauth-callback?code={CODE}`

4. **Edge Function exchanges code for long-lived token**
   - POST to `https://graph.facebook.com/v21.0/oauth/access_token`
   - Returns long-lived token (60 days validity)

5. **Fetch user info and connected accounts**
   - GET `/me` - User profile
   - GET `/me/accounts` - Facebook Pages (includes `instagram_business_account` field)
   - For each Instagram: GET `/{instagram_id}?fields=username,profile_picture_url`

6. **Store in database**
   - Insert/update `meta_connections` (user_id, access_token, meta_user_id)
   - Insert `meta_facebook_pages` records
   - Insert `meta_instagram_accounts` records

7. **Redirect back to app**
   - Frontend shows success message and connected accounts

---

## Database Schema

### Migration Files

1. **`20260708100000_meta_connections.sql`** - OAuth connections and accounts
2. **`20260708150000_scheduled_meta_posts.sql`** - Scheduled posts fields
3. **`20260708150100_schedule_meta_publisher.sql`** - Cron job setup
4. **`20260708200000_scheduled_posts_insert_policy.sql`** - INSERT RLS policy
5. **`20260708210000_scheduled_posts_authenticated_grants.sql`** - Table permissions

### Tables

#### `meta_connections`
Stores OAuth tokens and connection status.

```sql
CREATE TABLE meta_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_user_id TEXT NOT NULL,
  meta_user_name TEXT,
  meta_user_picture TEXT,
  access_token TEXT NOT NULL, -- Long-lived token (60 days)
  token_expires_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user lookups
CREATE INDEX meta_connections_user_id_idx ON meta_connections(user_id);
```

#### `meta_facebook_pages`
Stores linked Facebook Pages with their access tokens.

```sql
CREATE TABLE meta_facebook_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL UNIQUE,
  page_name TEXT NOT NULL,
  page_access_token TEXT NOT NULL, -- Page-specific token
  page_picture TEXT,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for connection lookups
CREATE INDEX meta_facebook_pages_connection_id_idx ON meta_facebook_pages(connection_id);
```

#### `meta_instagram_accounts`
Stores linked Instagram Business accounts.

```sql
CREATE TABLE meta_instagram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  instagram_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  profile_picture_url TEXT,
  linked_page_id TEXT NOT NULL, -- Facebook Page managing this Instagram
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  FOREIGN KEY (linked_page_id) REFERENCES meta_facebook_pages(page_id)
);

-- Index for connection lookups
CREATE INDEX meta_instagram_accounts_connection_id_idx ON meta_instagram_accounts(connection_id);
```

#### `scheduled_social_posts`
Stores scheduled posts for all platforms (extended for Meta).

```sql
-- New Meta-specific columns added:
ALTER TABLE scheduled_social_posts ADD COLUMN connection_id UUID REFERENCES meta_connections(id) ON DELETE SET NULL;
ALTER TABLE scheduled_social_posts ADD COLUMN target_platform_id TEXT; -- page_id or instagram_id
ALTER TABLE scheduled_social_posts ADD COLUMN target_name TEXT; -- Display name
ALTER TABLE scheduled_social_posts ADD COLUMN image_url TEXT; -- Image URL for post

-- Index for worker queries
CREATE INDEX scheduled_social_posts_meta_idx ON scheduled_social_posts(status, scheduled_at, connection_id)
WHERE platform IN ('facebook', 'instagram');

-- Constraint: Meta posts require connection_id and target_platform_id
ALTER TABLE scheduled_social_posts ADD CONSTRAINT meta_posts_require_connection
CHECK (
  (platform IN ('facebook', 'instagram') AND connection_id IS NOT NULL AND target_platform_id IS NOT NULL)
  OR (platform NOT IN ('facebook', 'instagram'))
);
```

### Row Level Security (RLS)

#### SELECT Policies

Users can view posts they created or posts owned by their Meta connection:

```sql
-- Policy 1: User is creator
CREATE POLICY scheduled_social_posts_creator_select ON scheduled_social_posts
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

-- Policy 2: User owns the Meta connection
-- (Added via meta connection check in frontend queries)
```

#### INSERT Policy

Users can insert posts if they own the Meta connection:

```sql
CREATE POLICY scheduled_social_posts_insert ON scheduled_social_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    -- For Meta posts, verify connection ownership
    (platform IN ('facebook', 'instagram') AND 
     EXISTS (
       SELECT 1 FROM meta_connections 
       WHERE id = connection_id AND user_id = auth.uid()
     ))
    OR
    -- For other platforms, use existing logic
    (platform NOT IN ('facebook', 'instagram') AND created_by = auth.uid())
  );
```

#### Table Permissions

Both `authenticated` and `service_role` need table-level permissions:

```sql
-- For authenticated users (frontend queries)
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_social_posts TO authenticated;

-- For service_role (Edge Functions)
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_social_posts TO service_role;

-- For RLS policy evaluation
GRANT SELECT ON requests TO authenticated;
```

---

## Immediate Posting

### Edge Function: `post-to-meta`

**Location:** `supabase/functions/post-to-meta/index.ts`

**Purpose:** Post content immediately to Facebook Pages or Instagram Business accounts.

**Authentication:** Accepts both user JWT (for frontend) and service_role (for worker).

#### Request Format

```typescript
POST /functions/v1/post-to-meta
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json

{
  "platform": "facebook" | "instagram",
  "target_id": "766722156534013",  // page_id or instagram_id
  "message": "Post caption text",
  "image_url": "https://example.com/image.jpg", // Optional
  "user_id": "uuid" // Required only for service_role calls
}
```

#### Response Format

```json
{
  "success": true,
  "platform": "facebook",
  "target_name": "BURD Software",
  "post_id": "766722156534013_122137081521107520"
}
```

#### Implementation Flow

**For Facebook Pages:**

1. Query `meta_connections` joined with `meta_facebook_pages`
2. Find page matching `target_id`
3. POST to Graph API: `https://graph.facebook.com/v21.0/{page_id}/feed`
   ```json
   {
     "message": "Post caption",
     "access_token": "{page_access_token}"
   }
   ```
4. Return post ID from response

**For Instagram:**

1. Query `meta_connections` joined with `meta_instagram_accounts`
2. Find Instagram account matching `target_id`
3. Get linked Facebook Page's access token
4. **Step 1 - Create Media Container:**
   ```
   POST https://graph.facebook.com/v21.0/{instagram_id}/media
   {
     "image_url": "{image_url}",
     "caption": "Post caption",
     "access_token": "{page_access_token}"
   }
   ```
   Returns: `{"id": "container_id"}`

5. **Step 2 - Publish Container:**
   ```
   POST https://graph.facebook.com/v21.0/{instagram_id}/media_publish
   {
     "creation_id": "{container_id}",
     "access_token": "{page_access_token}"
   }
   ```
   Returns: `{"id": "published_media_id"}`

6. Return published media ID

**Important Notes:**
- Instagram **requires** an image URL (cannot be empty)
- Instagram does not accept base64 data: URLs
- Use Page Access Token for Instagram API calls (not user token)

---

## Scheduled Posting

### Overview

Scheduled posting allows users to set a future date/time for post publication. A background worker (cron job) automatically publishes posts when their scheduled time arrives.

### Components

1. **Frontend UI** - Date/time picker and mode toggle
2. **Edge Function** - `schedule-social-post` (saves to database)
3. **Database Table** - `scheduled_social_posts` (queue)
4. **Cron Job** - Triggers worker every minute
5. **Worker Function** - `publish-scheduled-posts` (processes queue)

---

### 1. Scheduling Posts (Frontend → Database)

#### Edge Function: `schedule-social-post`

**Location:** `supabase/functions/schedule-social-post/index.ts`

**Purpose:** Validate and save scheduled posts to the database.

**Request Format:**

```typescript
POST /functions/v1/schedule-social-post
Authorization: Bearer {USER_JWT}
Content-Type: application/json

{
  "platform": "facebook" | "instagram",
  "caption": "Post text",
  "scheduled_at": "2026-07-09T14:30:00.000Z", // ISO 8601 format
  "connection_id": "bdcd579a-37ea-4d54-a7b1-ccadcc684456",
  "target_platform_id": "766722156534013",
  "target_name": "BURD Software",
  "image_url": "https://example.com/image.jpg", // Required for Instagram
  "brand_id": null, // Optional
  "title": "My scheduled post"
}
```

**Validation:**

1. ✅ User authentication via JWT
2. ✅ User owns the `connection_id` (query `meta_connections`)
3. ✅ Instagram posts must have `image_url`
4. ✅ `scheduled_at` is valid ISO 8601 datetime

**Database Insert:**

```typescript
const { data, error } = await db()
  .from('scheduled_social_posts')
  .insert({
    title,
    platform,
    caption,
    scheduled_at,
    status: 'scheduled',
    connection_id,
    target_platform_id,
    target_name,
    image_url,
    brand_id,
    created_by: userId,
    created_at: new Date().toISOString()
  })
  .select()
  .single();
```

**Response:**

```json
{
  "id": "998f72e4-2314-4db4-b9bc-9117ae8ac5de",
  "title": "My scheduled post",
  "platform": "instagram",
  "scheduled_at": "2026-07-09T14:30:00+00:00",
  "status": "scheduled"
}
```

---

### 2. Publishing Posts (Cron Worker)

#### Cron Job Configuration

**Location:** `supabase/migrations/20260708150100_schedule_meta_publisher.sql`

**Schedule:** Every minute (`* * * * *`)

**Implementation:**

```sql
SELECT cron.schedule(
  'publish-scheduled-meta-posts',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'http://127.0.0.1:54321/functions/v1/publish-scheduled-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'meta-cron-worker-2026'
    )
  ) AS request_id;
  $$
);
```

**Monitoring Cron Jobs:**

```sql
-- Check job status
SELECT jobname, schedule, active 
FROM cron.job 
WHERE jobname = 'publish-scheduled-meta-posts';

-- View execution history
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'publish-scheduled-meta-posts')
ORDER BY start_time DESC 
LIMIT 10;
```

---

#### Edge Function: `publish-scheduled-posts`

**Location:** `supabase/functions/publish-scheduled-posts/index.ts`

**Purpose:** Worker function that finds and publishes due posts.

**Authentication:** Requires `x-cron-secret` header (not JWT).

**Configuration:** `supabase/config.toml`

```toml
[functions.publish-scheduled-posts]
verify_jwt = false  # Worker uses secret-based auth
```

**Environment Variable:**

```bash
# supabase/functions/.env
CRON_SECRET=meta-cron-worker-2026
```

**Worker Flow:**

```typescript
// 1. Authenticate via secret
const cronSecret = req.headers.get('x-cron-secret');
if (cronSecret !== CRON_SECRET) {
  return json({ error: 'unauthorized' }, 401);
}

// 2. Find due posts
const { data: duePosts } = await supabase
  .from('scheduled_social_posts')
  .select('id, connection_id, platform, target_platform_id, target_name, caption, image_url')
  .eq('status', 'scheduled')
  .in('platform', ['facebook', 'instagram'])
  .lte('scheduled_at', new Date().toISOString())
  .limit(50);

// 3. For each post:
for (const post of duePosts) {
  try {
    // 3a. Verify connection is still active
    const { data: connection } = await supabase
      .from('meta_connections')
      .select('status, access_token, user_id')
      .eq('id', post.connection_id)
      .single();

    if (connection.status !== 'active') {
      throw new Error('Connection expired');
    }

    // 3b. Call post-to-meta function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/post-to-meta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        user_id: connection.user_id,  // Required for service_role
        platform: post.platform,
        target_id: post.target_platform_id,
        message: post.caption,
        image_url: post.image_url,
      }),
    });

    const result = await response.json();

    // 3c. Update post status
    if (result.success) {
      await supabase
        .from('scheduled_social_posts')
        .update({
          status: 'published',
          external_post_id: result.post_id,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    // 3d. Mark as failed
    await supabase
      .from('scheduled_social_posts')
      .update({
        status: 'failed',
        error_message: String(error),
        updated_at: new Date().toISOString(),
      })
      .eq('id', post.id);
  }
}

// 4. Return summary
return json({
  processed: duePosts.length,
  published: successCount,
  failed: failedCount,
  results: results
});
```

**Manual Testing:**

```bash
# Test worker manually
curl -s http://127.0.0.1:54321/functions/v1/publish-scheduled-posts \
  -H "x-cron-secret: meta-cron-worker-2026" \
  | jq '.'
```

**Example Response:**

```json
{
  "processed": 4,
  "published": 3,
  "failed": 1,
  "results": [
    {
      "id": "6e9a4c2a-83d4-42f4-8600-dbaf1c591263",
      "success": true,
      "post_id": "766722156534013_122137081521107520"
    },
    {
      "id": "998f72e4-2314-4db4-b9bc-9117ae8ac5de",
      "success": true,
      "post_id": "18104978036029144"
    },
    {
      "id": "206e72c4-65cf-4b70-b719-dd71d8d80ec0",
      "success": true,
      "post_id": "766722156534013_122137081545107520"
    },
    {
      "id": "2c35a51a-b52c-46d2-9033-fde92334f4db",
      "success": false,
      "error": "Error: Only photo or video can be accepted as media type."
    }
  ]
}
```

---

## Edge Functions

### Summary

| Function | Purpose | Auth | Invoked By |
|----------|---------|------|------------|
| `meta-oauth-callback` | Handle OAuth redirect, store tokens | None (public) | Meta OAuth |
| `post-to-meta` | Post immediately to FB/IG | User JWT or Service Role | Frontend / Worker |
| `schedule-social-post` | Save scheduled post | User JWT | Frontend |
| `publish-scheduled-posts` | Publish due posts | Cron Secret | Cron Job |
| `get-meta-connections` | Fetch user's connections | User JWT | Frontend |

### Shared Utilities

**Location:** `supabase/functions/_shared/db.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

// Returns Supabase client with service_role key (bypasses RLS)
export function db() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}
```

---

## Frontend Implementation

### Component: `MetaConnectionPage.tsx`

**Location:** `src/pages/admin/MetaConnectionPage.tsx`

**Features:**
1. OAuth connection button
2. Display connected Facebook Pages and Instagram accounts
3. Post mode toggle (Post Now / Schedule)
4. Date/time picker for scheduled posts
5. Test posting to selected account
6. Scheduled posts list with status badges
7. Auto-refresh (polls every 30 seconds)

### Key State

```typescript
const [postMode, setPostMode] = useState<'now' | 'scheduled'>('now');
const [scheduledDate, setScheduledDate] = useState('');
const [scheduledTime, setScheduledTime] = useState('');
const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
const [loadingScheduled, setLoadingScheduled] = useState(false);
```

### OAuth Connection

```typescript
const handleConnect = () => {
  const clientId = '2793081571067928';
  const redirectUri = encodeURIComponent(
    'http://localhost:54321/functions/v1/meta-oauth-callback'
  );
  const scopes = encodeURIComponent(
    'pages_show_list,pages_read_engagement,pages_manage_posts,' +
    'instagram_basic,instagram_content_publish,business_management'
  );
  
  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?` +
    `client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scopes}`;
  
  window.location.href = authUrl;
};
```

### Posting Logic

```typescript
const testPost = async () => {
  if (postMode === 'now') {
    // Immediate posting
    const { data, error } = await supabase.functions.invoke('post-to-meta', {
      body: {
        platform: selectedPlatform,
        target_id: selectedTargetId,
        message: testCaption,
        image_url: testImageUrl || null,
      },
    });
  } else {
    // Scheduled posting
    const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
    
    const { data, error } = await supabase.functions.invoke('schedule-social-post', {
      body: {
        platform: selectedPlatform,
        caption: testCaption,
        scheduled_at: scheduledDateTime.toISOString(),
        connection_id: connectionData.id,
        target_platform_id: selectedTargetId,
        target_name: selectedTargetName,
        image_url: testImageUrl || null,
        brand_id: null,
        title: `${selectedPlatform} post`,
      },
    });
  }
};
```

### Loading Scheduled Posts

```typescript
const loadScheduledPosts = async () => {
  const supabase = createSupabaseBrowserClient();
  const { data: posts, error } = await supabase
    .from('scheduled_social_posts')
    .select('*')
    .in('platform', ['facebook', 'instagram'])
    .in('status', ['scheduled', 'published', 'failed'])
    .order('scheduled_at', { ascending: false })
    .limit(20);
  
  if (!error) {
    setScheduledPosts(posts || []);
  }
};

// Auto-refresh every 30 seconds
useEffect(() => {
  if (data) {
    loadScheduledPosts();
    const interval = setInterval(loadScheduledPosts, 30000);
    return () => clearInterval(interval);
  }
}, [data]);
```

### Status Badge Component

```typescript
const StatusBadge = ({ status }: { status: string }) => {
  const styles = {
    scheduled: 'bg-blue-100 text-blue-800',
    published: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };
  
  const labels = {
    scheduled: '⏳ מתוזמן',
    published: '✅ פורסם',
    failed: '❌ נכשל',
  };
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};
```

---

## Configuration

### Meta App Configuration

**Location:** Meta for Developers Dashboard

1. Create a new Business App
2. Add "Facebook Login" product
3. Configure OAuth settings:
   - **Valid OAuth Redirect URIs:** `http://localhost:54321/functions/v1/meta-oauth-callback`
   - **Client OAuth Login:** Yes
   - **Use Strict Mode:** Yes
4. Request permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
   - `business_management`

### Environment Variables

**Location:** `supabase/functions/.env`

```bash
# Meta OAuth
META_APP_ID=2793081571067928
META_APP_SECRET=ef826e70dab15b2903ee5edf9005377c

# Redirect URL
APP_URL=http://localhost:8080

# Cron Worker Secret
CRON_SECRET=meta-cron-worker-2026

# Supabase (auto-provided)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
```

### Supabase Configuration

**Location:** `supabase/config.toml`

```toml
[functions.meta-oauth-callback]
verify_jwt = false  # Public OAuth endpoint

[functions.publish-scheduled-posts]
verify_jwt = false  # Worker uses secret auth
```

---

## Testing & Debugging

### 1. Test OAuth Connection

```bash
# Check stored connections
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
  SELECT 
    mc.id,
    mc.user_id,
    mc.meta_user_name,
    mc.status,
    COUNT(DISTINCT mfp.id) as facebook_pages,
    COUNT(DISTINCT mia.id) as instagram_accounts
  FROM meta_connections mc
  LEFT JOIN meta_facebook_pages mfp ON mfp.connection_id = mc.id
  LEFT JOIN meta_instagram_accounts mia ON mia.connection_id = mc.id
  GROUP BY mc.id;
"
```

### 2. Test Immediate Posting

```bash
# Get user JWT token from browser devtools (Application → Local Storage → supabase.auth.token)
JWT="eyJhbG..."

curl -X POST http://127.0.0.1:54321/functions/v1/post-to-meta \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "facebook",
    "target_id": "766722156534013",
    "message": "Test post from API"
  }'
```

### 3. Test Scheduled Posting

```bash
# Schedule a post for 2 minutes from now
SCHEDULED_AT=$(date -u -v+2M +"%Y-%m-%dT%H:%M:%S.000Z")

curl -X POST http://127.0.0.1:54321/functions/v1/schedule-social-post \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"platform\": \"facebook\",
    \"caption\": \"Test scheduled post\",
    \"scheduled_at\": \"$SCHEDULED_AT\",
    \"connection_id\": \"bdcd579a-37ea-4d54-a7b1-ccadcc684456\",
    \"target_platform_id\": \"766722156534013\",
    \"target_name\": \"BURD Software\",
    \"title\": \"Test post\"
  }"
```

### 4. Test Worker Manually

```bash
# Trigger worker
curl -s http://127.0.0.1:54321/functions/v1/publish-scheduled-posts \
  -H "x-cron-secret: meta-cron-worker-2026" \
  | jq '.'

# Check post statuses
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
  SELECT id, platform, target_name, status, external_post_id, error_message
  FROM scheduled_social_posts 
  WHERE platform IN ('facebook', 'instagram')
  ORDER BY scheduled_at DESC 
  LIMIT 10;
"
```

### 5. Monitor Cron Job

```bash
# Check if job is running
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
  SELECT jobname, schedule, active 
  FROM cron.job 
  WHERE jobname = 'publish-scheduled-meta-posts';
"

# View recent executions
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
  SELECT 
    runid,
    status,
    return_message,
    start_time,
    end_time
  FROM cron.job_run_details 
  WHERE jobid = (
    SELECT jobid FROM cron.job 
    WHERE jobname = 'publish-scheduled-meta-posts'
  )
  ORDER BY start_time DESC 
  LIMIT 5;
"
```

### 6. View Edge Function Logs

```bash
# Tail function logs in real-time
tail -f /tmp/edge-functions.log | grep -E "(publish-scheduled-posts|post-to-meta|schedule-social-post)"
```

### 7. Reset Scheduled Posts for Testing

```bash
# Reset all posts to scheduled status
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
  UPDATE scheduled_social_posts 
  SET status = 'scheduled', error_message = NULL 
  WHERE platform IN ('facebook', 'instagram');
"
```

---

## Common Issues & Solutions

### Issue 1: Posts Not Publishing

**Symptoms:** Posts stay in "scheduled" status past their scheduled time.

**Debug Steps:**
1. Check cron job is active: `SELECT * FROM cron.job WHERE jobname = 'publish-scheduled-meta-posts';`
2. Check recent cron executions: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;`
3. Verify CRON_SECRET is set: `echo $CRON_SECRET` in Edge Functions environment
4. Test worker manually with correct secret
5. Check Edge Function logs for errors

**Common Causes:**
- ❌ CRON_SECRET not set in `supabase/functions/.env`
- ❌ `verify_jwt = false` not set in config.toml
- ❌ Edge Functions server not running
- ❌ Connection status not 'active'

### Issue 2: "Unauthorized" Error

**Symptoms:** Worker returns "Unauthorized" when calling post-to-meta.

**Solution:** Ensure post-to-meta accepts service_role authentication:
- Check `user_id` is passed in request body
- Verify `isServiceRole` logic in post-to-meta function
- Use service_role key in Authorization header

### Issue 3: Instagram Posts Fail with "Only photo or video can be accepted"

**Symptoms:** Instagram posts fail while Facebook succeeds.

**Cause:** Instagram API requires a valid image URL.

**Solution:**
- Always provide `image_url` for Instagram posts
- Use public HTTP/HTTPS URLs (not data: URLs)
- Validate image URL is accessible before scheduling

### Issue 4: Scheduled Posts Not Showing in UI

**Symptoms:** Posts save successfully but don't appear in the scheduled posts list.

**Cause:** RLS policies or missing table permissions.

**Solution:**
```sql
-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_social_posts TO authenticated;
GRANT SELECT ON requests TO authenticated;

-- Verify user can query posts
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '{user_id}';
SELECT * FROM scheduled_social_posts WHERE platform IN ('facebook', 'instagram');
```

### Issue 5: Token Expired

**Symptoms:** Posts fail with "Invalid OAuth access token" or similar.

**Solution:**
- Long-lived tokens expire after 60 days
- User must re-connect (OAuth flow)
- Update `meta_connections.status` to 'expired'
- Show reconnection prompt in UI

---

## Future Enhancements

### Planned Features

1. **Token Refresh** - Automatic refresh of long-lived tokens before expiry
2. **Retry Logic** - Automatic retry for failed posts (3 attempts)
3. **Post Editing** - Edit scheduled posts before publication
4. **Bulk Scheduling** - Schedule multiple posts at once
5. **Analytics** - Track post performance (likes, comments, shares)
6. **Media Library** - Upload and manage images for posts
7. **Post Templates** - Save and reuse post templates
8. **Multi-Account** - Support multiple Meta connections per user
9. **Timezone Support** - User-specific timezone for scheduling
10. **Notification** - Email/push notifications on publish success/failure

### API Limitations

**Facebook Pages:**
- Rate limit: 200 calls per hour per user
- Post length: 63,206 characters
- Image size: Max 8 MB

**Instagram:**
- Rate limit: 25 posts per 24 hours per account
- Caption length: 2,200 characters
- Image requirements: Min 320px, aspect ratio 4:5 to 1.91:1
- Image size: Max 8 MB
- Image formats: JPG, PNG

---

## References

### Meta API Documentation

- [Facebook Graph API](https://developers.facebook.com/docs/graph-api/)
- [Facebook Pages API](https://developers.facebook.com/docs/pages-api)
- [Instagram Graph API](https://developers.facebook.com/docs/instagram-api)
- [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-api/guides/content-publishing)
- [Facebook OAuth](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow)

### Supabase Documentation

- [Edge Functions](https://supabase.com/docs/guides/functions)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [pg_cron Extension](https://supabase.com/docs/guides/database/extensions/pg_cron)

---

## Support

For issues or questions:
1. Check Edge Function logs: `tail -f /tmp/edge-functions.log`
2. Query database directly for debugging
3. Test API endpoints with curl
4. Review Meta App settings in Developer Dashboard
5. Check Supabase Dashboard for function invocations

---

**Last Updated:** 2026-07-09  
**Version:** 1.0  
**Author:** SimpleSolution Development Team
