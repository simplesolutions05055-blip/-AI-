// One-off seed: 5 example brands with real images from Wikimedia.
// Uploads logos to the `branding` bucket and inserts brands + brand_assets.
// Run: node scripts/seed-brands.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function env(name) {
  const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(name + '='));
  return line ? line.slice(name.length + 1).replace(/^"|"$/g, '').trim() : undefined;
}

const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('VITE_SUPABASE_URL');
const key = env('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('missing supabase url / service role key');
const db = createClient(url, key, { auth: { persistSession: false } });

const BRANDS = [
  {
    name: 'קרית שמונה',
    aliases: ['קריית שמונה', 'ק. שמונה', 'kiryat shmona'],
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Qiryat_Shemona_2007.JPG/500px-Qiryat_Shemona_2007.JPG',
    palette: [
      { hex: '#1F6F3C', role: 'primary' },
      { hex: '#0E3D6B', role: 'secondary' },
      { hex: '#F2C14E', role: 'accent' },
      { hex: '#FFFFFF', role: 'background' },
    ],
    style_notes: 'טון קהילתי וחם, פנייה לתושבי הצפון. דגש על טבע, ירוק ומשפחתיות.',
  },
  {
    name: 'תל אביב',
    aliases: ['תל-אביב', 'ת״א', 'תל אביב יפו', 'tel aviv'],
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Sarona_CBD_01_%28cropped%29.jpg/500px-Sarona_CBD_01_%28cropped%29.jpg',
    palette: [
      { hex: '#0072CE', role: 'primary' },
      { hex: '#111111', role: 'secondary' },
      { hex: '#FF5A5F', role: 'accent' },
      { hex: '#FFFFFF', role: 'background' },
    ],
    style_notes: 'אורבני, צעיר ואנרגטי. שפה מודרנית ונקייה, מתאים לעיר ללא הפסקה.',
  },
  {
    name: 'חיפה',
    aliases: ['haifa', 'חיפה והקריות'],
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/The_Hanging_Gardens_of_Haifa%2C_Israel_%2850099173503%29_%28cropped%29.jpg/500px-The_Hanging_Gardens_of_Haifa%2C_Israel_%2850099173503%29_%28cropped%29.jpg',
    palette: [
      { hex: '#0E7C7B', role: 'primary' },
      { hex: '#15487A', role: 'secondary' },
      { hex: '#7BB661', role: 'accent' },
      { hex: '#FFFFFF', role: 'background' },
    ],
    style_notes: 'עיר נמל ירוקה, מגוון ודו-קיום. שילוב של ים, גנים ומראה טכנולוגי.',
  },
  {
    name: 'ירושלים',
    aliases: ['jerusalem', 'י-ם', 'ירושלים בירת ישראל'],
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Dome_of_the_Rock_seen_from_the_Mount_of_Olives_%2812395649153%29_%28cropped%29.jpg/500px-Dome_of_the_Rock_seen_from_the_Mount_of_Olives_%2812395649153%29_%28cropped%29.jpg',
    palette: [
      { hex: '#B8860B', role: 'primary' },
      { hex: '#6B4F2A', role: 'secondary' },
      { hex: '#C9A66B', role: 'accent' },
      { hex: '#FBF6EC', role: 'background' },
    ],
    style_notes: 'מורשת והיסטוריה, אבן ירושלמית בגוון זהב. טון מכובד ומסורתי.',
  },
  {
    name: 'באר שבע',
    aliases: ['באר-שבע', 'ב״ש', 'beer sheva', 'beersheba'],
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Beersheba_City_Hall_6.jpg/500px-Beersheba_City_Hall_6.jpg',
    palette: [
      { hex: '#C2562B', role: 'primary' },
      { hex: '#2E4A6B', role: 'secondary' },
      { hex: '#E0B07A', role: 'accent' },
      { hex: '#FFFFFF', role: 'background' },
    ],
    style_notes: 'בירת הנגב, מדברי וצומח. גווני חול וטרקוטה, טון חדשני וצומח.',
  },
];

for (const b of BRANDS) {
  // skip if exists
  const { data: existing } = await db.from('brands').select('id').ilike('name', b.name).maybeSingle();
  if (existing) {
    console.log(`skip (exists): ${b.name}`);
    continue;
  }

  const { data: brand, error: be } = await db
    .from('brands')
    .insert({ name: b.name, aliases: b.aliases, color_palette: b.palette, style_notes: b.style_notes, is_active: true })
    .select('id')
    .single();
  if (be) { console.error(b.name, be.message); continue; }
  const id = brand.id;

  const res = await fetch(b.image, { headers: { 'User-Agent': 'branding-seed/1.0 (itayk93@gmail.com)' } });
  if (!res.ok) { console.error(b.name, 'image fetch', res.status); continue; }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const logoPath = `${id}/logo.jpg`;
  const up = await db.storage.from('branding').upload(logoPath, bytes, { contentType: 'image/jpeg', upsert: true });
  if (up.error) { console.error(b.name, 'upload', up.error.message); continue; }

  await db.from('brands').update({ logo_path: logoPath }).eq('id', id);
  await db.from('brand_assets').insert({ brand_id: id, storage_path: logoPath, mime_type: 'image/jpeg', caption: 'דוגמה לדמות חזותית' });
  console.log(`seeded: ${b.name} (${id})`);
}
console.log('done');
