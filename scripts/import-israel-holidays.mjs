const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const currentYear = new Date().getFullYear();
const years = process.argv.slice(2).map((year) => Number(year)).filter(Number.isInteger);
const targetYears = years.length > 0 ? years : [currentYear, currentYear + 1, currentYear + 2];

function stableExternalId(item) {
  return `${item.date}:${item.title}`.toLowerCase().replace(/[^a-z0-9:-]+/g, '-');
}

async function fetchHebcalYear(year) {
  const url = new URL('https://www.hebcal.com/hebcal');
  url.searchParams.set('v', '1');
  url.searchParams.set('cfg', 'json');
  url.searchParams.set('year', String(year));
  url.searchParams.set('maj', 'on');
  url.searchParams.set('min', 'on');
  url.searchParams.set('mod', 'on');
  url.searchParams.set('i', 'on');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hebcal ${year} failed: ${res.status} ${res.statusText}`);
  const payload = await res.json();
  return (payload.items ?? []).filter((item) => item.category === 'holiday');
}

async function upsertRows(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/israel_holidays?on_conflict=source,external_id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert failed: ${res.status} ${body}`);
  }
}

const rows = [];
for (const year of targetYears) {
  const items = await fetchHebcalYear(year);
  rows.push(
    ...items.map((item) => ({
      source: 'hebcal',
      external_id: stableExternalId(item),
      date: item.date,
      title: item.title,
      hebrew_title: item.hebrew ?? null,
      category: item.category,
      subcategory: item.subcat ?? null,
      memo: item.memo ?? null,
      link: item.link ?? null,
      is_major: item.subcat === 'major',
      is_israel_calendar: true,
      raw: item,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
  );
}

await upsertRows(rows);
console.log(`Imported ${rows.length} Israel holiday rows for ${targetYears.join(', ')}`);
