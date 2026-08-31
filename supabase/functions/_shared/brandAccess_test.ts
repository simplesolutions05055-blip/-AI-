// Cross-tenant isolation tests.
//
// The scenario these exist for: one person holds two phones, one for each
// authority. Nothing either phone says may pull the other authority's brand
// into a request. The industry name for the shape below is the
// "store-as-A, read-as-B" test — write a distinctive fact as tenant A, then try
// to reach it as tenant B and assert nothing comes back.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { allowedBrandIds, filterBrandsForUser, isBrandAllowed } from './brandAccess.ts';
import { type DB } from './db.ts';

const MIGDAL = 'brand-migdal-haemek';
const TEL_AVIV = 'brand-tel-aviv';

// Dana works for Migdal HaEmek. Yossi works for Tel Aviv. Neither is linked to
// the other's authority.
const DANA = 'user-dana';
const YOSSI = 'user-yossi';

const MEMBERSHIPS = [
  { user_id: DANA, brand_id: MIGDAL },
  { user_id: YOSSI, brand_id: TEL_AVIV },
];

const BRANDS = [
  { id: MIGDAL, name: 'מגדל העמק', aliases: ['מגדל'] },
  { id: TEL_AVIV, name: 'תל אביב', aliases: ['ת"א'] },
];

/** Minimal stand-in for the supabase client: only the one query this module makes. */
function fakeDb(rows = MEMBERSHIPS, opts: { fail?: boolean } = {}): DB {
  return {
    from(table: string) {
      assertEquals(table, 'user_brands');
      return {
        select() {
          return {
            eq(column: string, value: string) {
              assertEquals(column, 'user_id');
              if (opts.fail) return Promise.resolve({ data: null, error: { message: 'boom' } });
              return Promise.resolve({
                data: rows.filter((r) => r.user_id === value).map((r) => ({ brand_id: r.brand_id })),
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as DB;
}

Deno.test('each user sees only their own brand', async () => {
  assertEquals(await allowedBrandIds(fakeDb(), DANA), [MIGDAL]);
  assertEquals(await allowedBrandIds(fakeDb(), YOSSI), [TEL_AVIV]);
});

Deno.test('store as A, read as B: Yossi cannot reach the Migdal HaEmek brand', async () => {
  assertEquals(await isBrandAllowed(fakeDb(), DANA, MIGDAL), true);
  assertEquals(await isBrandAllowed(fakeDb(), YOSSI, MIGDAL), false);
  assertEquals(await isBrandAllowed(fakeDb(), DANA, TEL_AVIV), false);
});

Deno.test('naming the other authority cannot make it a candidate', () => {
  // Yossi types "מגדל העמק". Before this filter existed, the matcher searched
  // every active brand and would have stamped his request with MIGDAL.
  const yossiCandidates = filterBrandsForUser(BRANDS, [TEL_AVIV]);
  assertEquals(yossiCandidates.map((b) => b.id), [TEL_AVIV]);
  assertEquals(yossiCandidates.some((b) => b.id === MIGDAL), false);
});

Deno.test('a user with no membership matches nothing, not everything', async () => {
  assertEquals(await allowedBrandIds(fakeDb(), 'user-stranger'), []);
  assertEquals(filterBrandsForUser(BRANDS, []), []);
  assertEquals(await isBrandAllowed(fakeDb(), 'user-stranger', MIGDAL), false);
});

Deno.test('an ownerless request is not a wildcard', async () => {
  assertEquals(await allowedBrandIds(fakeDb(), null), []);
  assertEquals(await allowedBrandIds(fakeDb(), undefined), []);
  assertEquals(await allowedBrandIds(fakeDb(), ''), []);
  assertEquals(await isBrandAllowed(fakeDb(), null, MIGDAL), false);
});

Deno.test('a failed membership lookup denies rather than grants', async () => {
  assertEquals(await allowedBrandIds(fakeDb(MEMBERSHIPS, { fail: true }), DANA), []);
  assertEquals(await isBrandAllowed(fakeDb(MEMBERSHIPS, { fail: true }), DANA, MIGDAL), false);
});

Deno.test('a null brand is never allowed', async () => {
  assertEquals(await isBrandAllowed(fakeDb(), DANA, null), false);
  assertEquals(await isBrandAllowed(fakeDb(), DANA, undefined), false);
});

Deno.test('a user linked to both authorities keeps access to both', async () => {
  const shared = [...MEMBERSHIPS, { user_id: DANA, brand_id: TEL_AVIV }];
  const ids = await allowedBrandIds(fakeDb(shared), DANA);
  assertEquals(ids.sort(), [MIGDAL, TEL_AVIV].sort());
  assertEquals(filterBrandsForUser(BRANDS, ids).length, 2);
});

Deno.test('duplicate membership rows do not duplicate the brand', async () => {
  const dupes = [
    { user_id: DANA, brand_id: MIGDAL },
    { user_id: DANA, brand_id: MIGDAL },
  ];
  assertEquals(await allowedBrandIds(fakeDb(dupes), DANA), [MIGDAL]);
});
