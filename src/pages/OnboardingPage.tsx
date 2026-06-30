import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OnboardingState, ProfileGender } from '@/lib/useProfile';
import { Spinner } from '@/components/ui/Spinner';
import AdminNav, { AdminBottomNav } from '@/components/AdminNav';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import { useBrandTheme } from '@/lib/useBrandTheme';

type StepKey = 'details' | 'brand' | 'docs' | 'files';

interface UploadedItem {
  name: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

interface BrandDetails {
  id?: string;
  name: string;
  aliases: string[];
  style_notes: string;
  client_type: 'business' | 'municipality';
  color_palette: { hex: string; role: 'primary' | 'secondary' | 'accent' | 'background' | 'text' }[];
  logo_path?: string | null;
  logo_url?: string | null;
  official_name: string;
  short_name: string;
  slogan: string;
  department_name: string;
  contact_person_name: string;
  contact_person_title: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
  legal_id: string;
  default_form_number: string;
  document_footer_text: string;
  legal_disclaimer: string;
  signature_label: string;
  title_font_family: string;
  body_font_family: string;
  document_style: 'official' | 'modern' | 'municipal' | 'legal' | 'commercial';
  show_brand_background: boolean;
  show_contact_footer: boolean;
  document_usage: 'print' | 'digital' | 'both';
}

interface BrandCandidate extends Partial<BrandDetails> {
  id: string;
  name: string;
  match_score?: number;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const colorRoleLabels: Record<BrandDetails['color_palette'][number]['role'], string> = {
  primary: 'ראשי',
  secondary: 'משני',
  accent: 'הדגשה',
  background: 'רקע',
  text: 'טקסט',
};
const fontOptions = ['Assistant', 'Heebo', 'Noto Sans Hebrew', 'Arial', 'David', 'FrankRuehl'];

interface ContentSectionDef {
  key: string;
  title: string;
  description: string;
  placeholder: string;
}

// Each section maps to one business_text_sources row (matched by `title`), so the
// content brain is shared with every user attached to the brand.
const CONTENT_SECTIONS: ContentSectionDef[] = [
  {
    key: 'general',
    title: 'תיאור כללי של המותג',
    description: 'מי אתם, מה הסיפור והייחוד.',
    placeholder: 'תארו בכמה משפטים את המותג / העסק / הרשות, התחום והערכים המרכזיים.',
  },
  {
    key: 'audience',
    title: 'קהלי יעד',
    description: 'למי אתם פונים.',
    placeholder: 'תושבים, לקוחות, גילאים, מגזרים, קהילות — קהל בכל שורה.',
  },
  {
    key: 'services',
    title: 'שירותים, מוצרים ותחומי פעילות',
    description: 'מה אתם מציעים.',
    placeholder: 'פרטו שירותים, מוצרים או תחומי אחריות מרכזיים.',
  },
  {
    key: 'tone',
    title: 'טון וסגנון כתיבה',
    description: 'איך מדברים בשם המותג.',
    placeholder: 'רשמי / ידידותי / ענייני, גוף פנייה, מילים שאוהבים או נמנעים מהן.',
  },
  {
    key: 'messaging',
    title: 'מסרים מרכזיים — חובה ואסור',
    description: 'מה תמיד אומרים ומה לא.',
    placeholder: 'מסרים שחובה להעביר, והנחיות על מה אסור לכתוב.',
  },
  {
    key: 'service',
    title: 'שירות ופניות הציבור',
    description: 'איך פונים אליכם.',
    placeholder: 'שעות פעילות, ערוצי פנייה, מוקד, כתובות ונהלים.',
  },
  {
    key: 'examples',
    title: 'דוגמאות טקסטים קיימים',
    description: 'ניסוחים שכבר עובדים.',
    placeholder: 'הדביקו פוסטים, הודעות או טקסטים קיימים כדוגמה לסגנון.',
  },
];

interface ContentSource {
  id?: string;
  title: string;
  content: string;
}
const emptyBrand: BrandDetails = {
  name: '',
  aliases: [],
  style_notes: '',
  client_type: 'business',
  color_palette: [
    { role: 'primary', hex: '#1A4D9C' },
    { role: 'secondary', hex: '#0F766E' },
    { role: 'accent', hex: '#F59E0B' },
    { role: 'background', hex: '#FFFFFF' },
    { role: 'text', hex: '#111827' },
  ],
  logo_path: null,
  logo_url: null,
  official_name: '',
  short_name: '',
  slogan: '',
  department_name: '',
  contact_person_name: '',
  contact_person_title: '',
  address: '',
  phone: '',
  fax: '',
  email: '',
  website: '',
  legal_id: '',
  default_form_number: '',
  document_footer_text: '',
  legal_disclaimer: '',
  signature_label: '',
  title_font_family: 'Assistant',
  body_font_family: 'Assistant',
  document_style: 'official',
  show_brand_background: true,
  show_contact_footer: true,
  document_usage: 'print',
};

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [canCreateOutputs, setCanCreateOutputs] = useState(false);
  const [hasBrand, setHasBrand] = useState(false);
  const [requireUploads, setRequireUploads] = useState(false);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [brandDone, setBrandDone] = useState(false);
  const [brand, setBrand] = useState<BrandDetails>(emptyBrand);
  const [brandMode, setBrandMode] = useState<'idle' | 'existing' | 'new'>('idle');
  const [brandLogoFile, setBrandLogoFile] = useState<File | null>(null);
  const [brandLogoPreview, setBrandLogoPreview] = useState<string | null>(null);
  const [brandLookupLoading, setBrandLookupLoading] = useState(false);
  const [brandLookupMessage, setBrandLookupMessage] = useState<string | null>(null);
  const [brandCandidates, setBrandCandidates] = useState<BrandCandidate[]>([]);
  const [brandCandidatesOpen, setBrandCandidatesOpen] = useState(false);
  const [brandColorModalOpen, setBrandColorModalOpen] = useState(false);
  const [brandColorAnalyzing, setBrandColorAnalyzing] = useState(false);
  const [brandColorSummary, setBrandColorSummary] = useState<string | null>(null);
  const [brandColorAnalysis, setBrandColorAnalysis] = useState<{ estimated_cost: number; confidence: number; model: string } | null>(null);
  const [brandLogoSaving, setBrandLogoSaving] = useState(false);
  const [contentSources, setContentSources] = useState<ContentSource[]>([]);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [navMounted, setNavMounted] = useState(false);
  const [navVisible, setNavVisible] = useState(false);

  // step 1 fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [gender, setGender] = useState<ProfileGender | ''>('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // uploads
  const [docs, setDocs] = useState<UploadedItem[]>([]);
  const [assets, setAssets] = useState<UploadedItem[]>([]);

  const progress = useRef<OnboardingState>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const steps: StepKey[] = useMemo(() => ['details', 'brand', 'docs', 'files'], []);
  const step = steps[stepIndex];

  useBrandTheme(!!userId);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        navigate('/login', { replace: true });
        return;
      }

      const [{ data: profile }, { data: brands }, { data: setting }] = await Promise.all([
        supabase
          .from('profiles')
          .select('email, role, can_create_outputs, full_name, phone, job_title, gender, avatar_path, onboarding')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('user_brands')
          .select(
            'brand_id, brands(id, name, aliases, logo_path, color_palette, style_notes, client_type, official_name, short_name, slogan, department_name, contact_person_name, contact_person_title, address, phone, fax, email, website, legal_id, default_form_number, document_footer_text, legal_disclaimer, signature_label, title_font_family, body_font_family, document_style, show_brand_background, show_contact_footer, document_usage)',
          )
          .eq('user_id', user.id),
        supabase.from('settings').select('value_json').eq('key', 'onboarding_require_uploads').maybeSingle(),
      ]);
      if (!active) return;

      const p = profile as {
        full_name?: string | null;
        phone?: string | null;
        job_title?: string | null;
        gender?: ProfileGender | null;
        email?: string | null;
        role?: 'admin' | 'user' | null;
        can_create_outputs?: boolean | null;
        avatar_path?: string | null;
        onboarding?: OnboardingState;
      } | null;
      setUserId(user.id);
      setEmail(p?.email ?? user.email ?? '');
      setRole(p?.role ?? 'user');
      setCanCreateOutputs(p?.can_create_outputs === true);
      setFullName(p?.full_name ?? '');
      setPhone(p?.phone ?? '');
      setJobTitle(p?.job_title ?? '');
      setGender(p?.gender ?? '');
      progress.current = p?.onboarding ?? {};
      setBrandDone(p?.onboarding?.brand_done === true);

      if (p?.avatar_path) {
        const { data: avatarUrl } = await supabase.storage.from('avatars').createSignedUrl(p.avatar_path, 60 * 60);
        if (active) setAvatarPreview(avatarUrl?.signedUrl ?? null);
      }

      const brandRows = (brands as { brand_id?: string; brands?: Partial<BrandDetails> | null }[] | null) ?? [];
      setHasBrand(brandRows.length > 0);
      setBrandName(brandRows[0]?.brands?.name ?? null);
      if (brandRows[0]?.brands) {
        const loaded = brandFromRow(brandRows[0].brands);
        setBrand(loaded);
        setBrandMode('existing');
        if (loaded.logo_path) {
          const { data: logoUrl } = await supabase.storage.from('branding').createSignedUrl(loaded.logo_path, 60 * 60);
          if (active) {
            setBrand((cur) => ({ ...cur, logo_url: logoUrl?.signedUrl ?? null }));
            setBrandLogoPreview(logoUrl?.signedUrl ?? null);
          }
        }
        const brandId = brandRows[0]?.brand_id ?? loaded.id;
        if (brandId && active) await loadContentSections(brandId);
      }
      setRequireUploads(((setting as { value_json?: unknown } | null)?.value_json as boolean | undefined) === true);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, navigate]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  useEffect(() => {
    if (navOpen) {
      setNavMounted(true);
      const frame = window.requestAnimationFrame(() => setNavVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setNavVisible(false);
    const timeout = window.setTimeout(() => setNavMounted(false), 320);
    return () => window.clearTimeout(timeout);
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  useEffect(() => {
    if (!avatarModalOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAvatarModalOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [avatarModalOpen]);

  useEffect(() => {
    if (!brandColorModalOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setBrandColorModalOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [brandColorModalOpen]);

  useEffect(() => {
    return () => {
      if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
      if (brandLogoPreview?.startsWith('blob:')) URL.revokeObjectURL(brandLogoPreview);
    };
  }, [avatarPreview, brandLogoPreview]);

  function onPickAvatar(file: File | null) {
    if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(file ? URL.createObjectURL(file) : null);
  }

  function onPickBrandLogo(file: File | null) {
    if (brandLogoPreview?.startsWith('blob:')) URL.revokeObjectURL(brandLogoPreview);
    if (file && file.size > MAX_LOGO_BYTES) {
      setError('הלוגו גדול מ-5MB.');
      return;
    }
    setBrandLogoFile(file);
    setBrandLogoPreview(file ? URL.createObjectURL(file) : brand.logo_url ?? null);
    if (file && brandMode === 'existing' && brand.id) {
      void saveBrandLogoNow(file);
    }
  }

  async function saveBrandLogoNow(file: File) {
    if (!brand.id) return;
    setBrandLogoSaving(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('onboarding-brand', {
        body: {
          action: 'save',
          brand_id: brand.id,
          name: brand.name,
          aliases: brand.aliases,
          style_notes: brand.style_notes,
          client_type: brand.client_type,
          color_palette: brand.color_palette,
          logo_base64: await fileToBase64(file),
          logo_mime: file.type,
          logo_name: file.name,
          official_name: brand.official_name,
          short_name: brand.short_name,
          slogan: brand.slogan,
          department_name: brand.department_name,
          contact_person_name: brand.contact_person_name,
          contact_person_title: brand.contact_person_title,
          address: brand.address,
          phone: brand.phone,
          fax: brand.fax,
          email: brand.email,
          website: brand.website,
          legal_id: brand.legal_id,
          default_form_number: brand.default_form_number,
          document_footer_text: brand.document_footer_text,
          legal_disclaimer: brand.legal_disclaimer,
          signature_label: brand.signature_label,
          title_font_family: brand.title_font_family,
          body_font_family: brand.body_font_family,
          document_style: brand.document_style,
          show_brand_background: brand.show_brand_background,
          show_contact_footer: brand.show_contact_footer,
          document_usage: brand.document_usage,
        },
      });
      const payload = data as { error?: string; brand?: Partial<BrandDetails> & { logo_url?: string | null } } | null;
      if (fnErr || payload?.error || !payload?.brand) throw new Error(payload?.error ?? 'failed');
      const loaded = brandFromRow(payload.brand);
      setBrand((cur) => ({ ...cur, ...loaded, logo_url: payload.brand.logo_url ?? loaded.logo_url ?? null }));
      setBrandLogoPreview(payload.brand.logo_url ?? brandLogoPreview ?? null);
    } catch (e) {
      console.error(e);
      setError('שמירת הלוגו למותג הקיים נכשלה. אפשר לנסות שוב דרך שמירת המותג.');
    } finally {
      setBrandLogoSaving(false);
    }
  }

  function hasCustomBrandPalette() {
    return brand.color_palette.some((color, index) => color.hex !== emptyBrand.color_palette[index]?.hex);
  }

  function onAvatarButtonClick() {
    if (avatarPreview) {
      setAvatarModalOpen(true);
      return;
    }
    avatarInputRef.current?.click();
  }

  function resetSelectedBrand() {
    if (brandLogoPreview?.startsWith('blob:')) URL.revokeObjectURL(brandLogoPreview);
    setBrand(emptyBrand);
    setBrandMode('idle');
    setHasBrand(false);
    setBrandDone(false);
    setBrandName(null);
    setBrandLogoFile(null);
    setBrandLogoPreview(null);
    setBrandLookupMessage(null);
    setBrandCandidates([]);
    setBrandCandidatesOpen(false);
    setBrandColorModalOpen(false);
    setBrandColorAnalyzing(false);
    setBrandColorSummary(null);
    setBrandColorAnalysis(null);
    setContentSources([]);
    setContentLoaded(false);
    setError(null);
  }

  async function getBrandLogoBase64(): Promise<{ base64: string; mime: string; name: string } | null> {
    if (brandLogoFile) {
      return {
        base64: await fileToBase64(brandLogoFile),
        mime: brandLogoFile.type || 'image/png',
        name: brandLogoFile.name,
      };
    }
    if (brand.logo_url) {
      const res = await fetch(brand.logo_url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return {
        base64: await blobToBase64(blob),
        mime: blob.type || 'image/png',
        name: brand.logo_path?.split('/').pop() ?? 'logo',
      };
    }
    return null;
  }

  async function analyzeBrandColors() {
    setError(null);
    setBrandColorSummary(null);
    setBrandColorAnalysis(null);
    const logo = await getBrandLogoBase64();
    if (!logo) {
      setError('צריך להעלות לוגו או לבחור מותג עם לוגו כדי לזהות צבעים.');
      return;
    }

    setBrandColorAnalyzing(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('analyze-brand-colors', {
        body: {
          logo_base64: logo.base64,
          logo_mime: logo.mime,
          logo_name: logo.name,
          brand_name: brand.name || brandName || null,
        },
      });
      const payload = data as
        | {
            error?: string;
            summary?: string;
            colors?: { role: BrandDetails['color_palette'][number]['role']; hex: string; reason?: string | null }[];
            estimated_cost?: number;
            confidence?: number;
            model?: string;
          }
        | null;
      if (fnErr || payload?.error) throw new Error(payload?.error ?? 'failed');
      if (!payload) throw new Error('failed');

      if (Array.isArray(payload.colors) && payload.colors.length > 0) {
        setBrand((cur) => ({
          ...cur,
          color_palette: cur.color_palette.map((item) => {
            const found = payload.colors?.find((color) => color.role === item.role);
            return found ? { ...item, hex: found.hex } : item;
          }),
        }));
      }

      setBrandColorSummary(payload.summary ?? 'זוהו צבעי מותג מרכזיים.');
      setBrandColorAnalysis({
        estimated_cost: Number(payload.estimated_cost ?? 0),
        confidence: Number(payload.confidence ?? 0),
        model: payload.model ?? 'gpt-4o',
      });
    } catch (e) {
      console.error(e);
      setError('זיהוי צבעי המותג נכשל. נסו שוב אחרי בדיקת הלוגו.');
    } finally {
      setBrandColorAnalyzing(false);
    }
  }

  async function loadContentSections(brandId: string) {
    const { data, error: loadError } = await supabase
      .from('business_text_sources')
      .select('id, title, content')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true });
    if (loadError || !Array.isArray(data)) {
      setContentLoaded(false);
      return;
    }
    setContentSources(
      data.map((row) => {
        const r = row as { id: string; title?: string | null; content?: string | null };
        return { id: r.id, title: r.title ?? '', content: r.content ?? '' };
      }),
    );
    setContentLoaded(true);
  }

  async function saveDetailsAndNext() {
    setError(null);
    if (!fullName.trim() || !gender) {
      setError('יש למלא שם מלא ולבחור לשון פנייה.');
      return;
    }
    if (!userId) return;
    setSaving(true);
    try {
      let avatar_path: string | undefined;
      if (avatarFile) {
        const ext = avatarFile.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '.png';
        const path = `${userId}/avatar${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
        if (upErr) throw upErr;
        avatar_path = path;
      }

      progress.current = { ...progress.current, details_done: true };
      const { error: updErr } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          job_title: jobTitle.trim() || null,
          gender,
          ...(avatar_path ? { avatar_path } : {}),
          onboarding: progress.current,
        } as never)
        .eq('id', userId);
      if (updErr) throw updErr;

      advance();
    } catch (e) {
      setError('שמירת הפרטים נכשלה. נסו שוב.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function resolveBrandByName() {
    const name = brand.name.trim();
    if (!name || brandDone) return;
    setBrandLookupLoading(true);
    setError(null);
    setBrandLookupMessage(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('onboarding-brand', {
        body: { action: 'resolve', name },
      });
      const payload = data as {
        error?: string;
        mode?: 'existing' | 'new' | 'candidates';
        brand?: Partial<BrandDetails> & { logo_url?: string | null } | null;
        candidates?: BrandCandidate[];
      } | null;
      if (fnErr || payload?.error) throw new Error(payload?.error ?? 'failed');
      if (payload?.mode === 'existing' && payload.brand) {
        const loaded = brandFromRow(payload.brand);
        setBrand({ ...loaded, logo_url: payload.brand.logo_url ?? loaded.logo_url ?? null });
        setBrandLogoPreview(payload.brand.logo_url ?? null);
        setBrandMode('existing');
        setHasBrand(true);
        setBrandName(loaded.name);
        setBrandCandidates([]);
        setBrandCandidatesOpen(false);
        setBrandLookupMessage(null);
        if (loaded.id) await loadContentSections(loaded.id);
      } else if (payload?.mode === 'candidates' && payload.candidates?.length) {
        setBrandCandidates(payload.candidates);
        setBrandCandidatesOpen(true);
        setBrandLookupMessage('נמצאו כמה מותגים דומים. צריך לבחור את המותג הנכון.');
      } else {
        setBrand((cur) => ({ ...cur, name }));
        setBrandMode('new');
        setBrandCandidates([]);
        setBrandCandidatesOpen(false);
        setBrandLookupMessage('לא נמצא מותג קיים בשם הזה. אפשר ליצור מותג חדש.');
      }
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'failed';
      setError(`בדיקת המותג נכשלה (${message}). אם הפונקציה עוד לא פרוסה, צריך לפרוס את onboarding-brand.`);
    } finally {
      setBrandLookupLoading(false);
    }
  }

  async function confirmBrandCandidate(candidate: BrandCandidate) {
    setSaving(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('onboarding-brand', {
        body: { action: 'confirm', brand_id: candidate.id },
      });
      const payload = data as { error?: string; mode?: 'existing'; brand?: Partial<BrandDetails> & { logo_url?: string | null } } | null;
      if (fnErr || payload?.error || !payload?.brand) throw new Error(payload?.error ?? 'failed');
      const loaded = brandFromRow(payload.brand);
      setBrand({ ...loaded, logo_url: payload.brand.logo_url ?? loaded.logo_url ?? null });
      setBrandLogoPreview(payload.brand.logo_url ?? null);
      setBrandMode('existing');
      setHasBrand(true);
      setBrandName(loaded.name);
      setBrandCandidates([]);
      setBrandCandidatesOpen(false);
      setBrandLookupMessage(null);
      if (loaded.id) await loadContentSections(loaded.id);
    } catch (e) {
      console.error(e);
      setError('שיוך המותג נכשל. נסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  async function saveBrandAndNext() {
    setError(null);
    const name = brand.name.trim();
    if (!name) {
      setError('יש למלא שם מותג.');
      return;
    }
    setSaving(true);
    try {
      const logoPayload = brandLogoFile ? {
        logo_base64: await fileToBase64(brandLogoFile),
        logo_mime: brandLogoFile.type,
        logo_name: brandLogoFile.name,
      } : {};
      // Only sync content when we actually loaded the brand's sources (or it's a new
      // brand) — never send for an existing brand whose content failed to load, or we
      // would wipe the shared content brain.
      const includeContent = contentLoaded || brandMode !== 'existing';
      const { data, error: fnErr } = await supabase.functions.invoke('onboarding-brand', {
        body: {
          action: 'save',
          ...brand,
          brand_id: brand.id,
          name,
          ...logoPayload,
          ...(includeContent
            ? {
                content_sources: contentSources.map((source) => ({
                  id: source.id ?? null,
                  title: source.title,
                  content: source.content,
                })),
              }
            : {}),
        },
      });
      const payload = data as { error?: string; mode?: 'existing' | 'created' | 'updated'; brand?: Partial<BrandDetails> & { logo_url?: string | null } } | null;
      if (fnErr || payload?.error || !payload?.brand) throw new Error(payload?.error ?? 'failed');
      const loaded = brandFromRow(payload.brand);
      setBrand({ ...loaded, logo_url: payload.brand.logo_url ?? loaded.logo_url ?? null });
      setBrandLogoPreview(payload.brand.logo_url ?? null);
      setBrandMode(payload.mode === 'existing' ? 'existing' : 'new');
      setHasBrand(true);
      setBrandName(loaded.name);
      setBrandDone(true);
      setCanCreateOutputs(true);
      progress.current = { ...progress.current, brand_done: true };
      setStepIndex(2);
    } catch (e) {
      console.error(e);
      setError('שמירת המותג נכשלה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(kind: 'document' | 'asset', files: FileList | null) {
    if (!files || files.length === 0) return;
    const setList = kind === 'document' ? setDocs : setAssets;

    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setList((cur) => [...cur, { name: file.name, status: 'error', error: 'הקובץ גדול מ-25MB' }]);
        continue;
      }
      const idx = await new Promise<number>((resolve) =>
        setList((cur) => {
          resolve(cur.length);
          return [...cur, { name: file.name, status: 'uploading' }];
        }),
      );
      try {
        const base64 = await fileToBase64(file);
        const { data, error: fnErr } = await supabase.functions.invoke('onboarding-ingest', {
          body: { kind, base64, mime: file.type, name: file.name },
        });
        const errCode = (data as { error?: string } | null)?.error;
        if (fnErr || errCode) throw new Error(errCode ?? 'failed');

        progress.current = {
          ...progress.current,
          ...(kind === 'document' ? { docs_done: true } : { files_done: true }),
        };
        setList((cur) => cur.map((it, i) => (i === idx ? { ...it, status: 'done' } : it)));
      } catch (e) {
        console.error(e);
        setList((cur) =>
          cur.map((it, i) => (i === idx ? { ...it, status: 'error', error: 'ההעלאה נכשלה' } : it)),
        );
      }
    }
  }

  function advance() {
    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      finish();
    }
  }

  async function finish() {
    if (!userId) return;
    setSaving(true);
    try {
      progress.current = { ...progress.current, hard_completed_at: new Date().toISOString() };
      await supabase.from('profiles').update({ onboarding: progress.current } as never).eq('id', userId);
      navigate('/admin', { replace: true });
    } finally {
      setSaving(false);
    }
  }

  const docsUploaded = docs.some((d) => d.status === 'done');
  const assetsUploaded = assets.some((a) => a.status === 'done');
  // When uploads are mandatory, the user must add at least one item to continue.
  const canLeaveStep =
    step === 'details' || step === 'brand' ? true : step === 'docs' ? !requireUploads || docsUploaded : !requireUploads || assetsUploaded;

  if (loading) {
    return <main className="grid min-h-[100dvh] place-items-center text-[var(--muted)]"><Spinner /></main>;
  }

  const isAdmin = role === 'admin';
  const editingExistingBrand = brandMode === 'existing';

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#f6f9f8] text-[#071a33]">
      <div className="hidden lg:flex lg:h-[100dvh] lg:w-60 lg:shrink-0 lg:border-l lg:border-[#d7e3e0] lg:bg-white">
        <div className="lg:h-[100dvh] lg:w-full">
          <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={canCreateOutputs} />
        </div>
      </div>

      {navMounted && (
        <div
          className={`fixed inset-0 z-40 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
            navVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="תפריט ניווט"
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-black/40"
            aria-label="סגירת התפריט"
            onClick={() => setNavOpen(false)}
          />
          <div
            className={`absolute bottom-0 right-0 top-0 w-[min(84vw,320px)] origin-right overflow-hidden shadow-xl transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
              navVisible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-[0.985]'
            }`}
          >
            <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={canCreateOutputs} onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-h-0 w-full flex-1 overflow-y-auto px-4 py-8 pb-[calc(var(--safe-bottom)+5.75rem)] lg:pb-8">
        <div className="mx-auto w-full max-w-lg">
          <Stepper steps={steps} current={stepIndex} />

          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm">
            {step === 'details' && (
              <section>
                <h1 className="text-xl font-bold">ברוכים הבאים 👋</h1>
                <p className="mb-5 mt-1 text-sm text-[var(--muted)]">כמה פרטים קצרים כדי להכיר אתכם.</p>

                <div className="mb-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onAvatarButtonClick}
                    className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-gray-50 ring-offset-2 transition hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                    aria-label={avatarPreview ? 'פתיחת תמונת פרופיל' : 'בחירת תמונת פרופיל'}
                  >
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xl text-[var(--muted)]">🙂</span>
                    )}
                  </button>
                  <div>
                    <button
                      type="button"
                      onClick={onAvatarButtonClick}
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      {avatarPreview ? 'צפייה בתמונת פרופיל' : 'העלאת תמונת פרופיל'}
                    </button>
                    <p className="mt-1 text-xs text-[var(--muted)]">אופציונלי</p>
                  </div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
                  />
                </div>

                <Field label="שם מלא">
                  <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </Field>
                <Field label="טלפון (אופציונלי)">
                  <input
                    className={inputCls}
                    type="tel"
                    dir="ltr"
                    style={{ textAlign: 'right' }}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <Field label="תפקיד / עיסוק (אופציונלי)">
                  <input className={inputCls} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                </Field>
                <div className="mb-4">
                  <span className="mb-1 block text-sm font-medium">לשון פנייה</span>
                  <p className="mb-2 text-xs text-[var(--muted)]">כדי שנפנה אליכם בלשון המתאימה.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <GenderOption value="male" selected={gender} onChange={setGender} label="זכר" />
                    <GenderOption value="female" selected={gender} onChange={setGender} label="נקבה" />
                  </div>
                </div>

                {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

                <button
                  onClick={saveDetailsAndNext}
                  disabled={saving}
                  className="mt-2 w-full rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {saving ? 'שומר...' : steps.length > 1 ? 'המשך' : 'סיום וכניסה'}
                </button>
              </section>
            )}

            {step === 'brand' && (
              <section>
                <h1 className="text-xl font-bold">פרטי המותג</h1>
                <p className="mb-5 mt-1 text-sm text-[var(--muted)]">
                  הקלידו שם מותג. אם הוא כבר קיים, הפרטים ייטענו אוטומטית.
                </p>

                <Field label="שם מותג">
                  <div className="flex gap-2">
                    <input
                      className={inputCls}
                      value={brand.name}
                      onChange={(e) => {
                        setBrand((cur) => ({ ...cur, name: e.target.value }));
                        if (!brandDone) setBrandMode('idle');
                        setBrandCandidates([]);
                        setBrandLookupMessage(null);
                      }}
                      onBlur={resolveBrandByName}
                    />
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={resolveBrandByName}
                      disabled={brandLookupLoading || !brand.name.trim()}
                      className="shrink-0 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
                    >
                      {brandLookupLoading ? 'בודק...' : 'בדיקה חוזרת'}
                    </button>
                  </div>
                </Field>

                {brandMode === 'existing' && (
                  <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      נמצא מותג קיים והפרטים שלו נטענו. כל שינוי שתשמרו כאן יעדכן את המותג המשותף ויופיע גם למשתמשים אחרים שמשויכים אליו.
                      אם זה לא המותג הנכון, לחצו על שינוי המותג והקלידו מחדש.
                    </span>
                    <button
                      type="button"
                      onClick={resetSelectedBrand}
                      className="shrink-0 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100"
                    >
                      שינוי המותג
                    </button>
                  </div>
                )}
                {brandLookupMessage && (
                  <div className="mb-4 rounded-xl border border-[var(--border)] bg-gray-50 px-4 py-3 text-sm text-[var(--muted)]">
                    {brandLookupMessage}
                  </div>
                )}
                {brandCandidates.length > 0 && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    נמצאו כמה מותגים דומים. בחרו את המותג הנכון בחלון האישור.
                  </div>
                )}
                {brandMode === 'new' && (
                  <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    זה מותג חדש. מלאו את הפרטים הבסיסיים כדי ליצור אותו.
                  </div>
                )}

                <div className="mb-4 flex items-center gap-3">
                  <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--border)] bg-gray-50">
                    {brandLogoPreview ? (
                      <img src={brandLogoPreview} alt="" className="h-full w-full object-contain p-1" />
                    ) : (
                      <span className="text-xs font-semibold text-[var(--muted)]">לוגו</span>
                    )}
                  </div>
                  <label className="cursor-pointer text-sm font-medium text-brand hover:underline">
                    העלאת לוגו
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onPickBrandLogo(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <span className="text-xs text-[var(--muted)]">
                    אופציונלי, עד 5MB{brandMode === 'existing' && brand.id ? ' · נשמר אוטומטית למותג הקיים' : ''}
                  </span>
                </div>
                {brandLogoSaving && <p className="mb-4 text-xs text-[var(--muted)]">שומר לוגו למותג...</p>}

                {!hasCustomBrandPalette() && (
                  <button
                    type="button"
                    onClick={() => setBrandColorModalOpen(true)}
                    className="mb-4 w-full rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-right text-sm font-semibold text-brand hover:bg-brand/10"
                  >
                    זיהוי צבעי מותג מהלוגו
                  </button>
                )}

                <Field label="סוג לקוח">
                  <select
                    className={inputCls}
                    value={brand.client_type}
                    onChange={(e) => setBrand((cur) => ({ ...cur, client_type: e.target.value as BrandDetails['client_type'] }))}
                  >
                    <option value="business">עסק</option>
                    <option value="municipality">רשות / גוף ציבורי</option>
                  </select>
                </Field>

                <Field label="הסבר / הנחיות מותג">
                  <textarea
                    className={`${inputCls} min-h-24 resize-y`}
                    value={brand.style_notes}
                    onChange={(e) => setBrand((cur) => ({ ...cur, style_notes: e.target.value }))}
                  />
                </Field>

                <Field label="כינויים / שמות נוספים">
                  <textarea
                    className={`${inputCls} min-h-20 resize-y`}
                    value={brand.aliases.join('\n')}
                    onChange={(e) =>
                      setBrand((cur) => ({
                        ...cur,
                        aliases: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean),
                      }))
                    }
                  />
                </Field>

                <div className="mb-4">
                  <span className="mb-2 block text-sm font-medium">צבעי מותג</span>
                  <div className="grid grid-cols-3 gap-2">
                    {brand.color_palette.map((color, index) => (
                      <label key={color.role} className="rounded-lg border border-[var(--border)] p-2 text-xs">
                        <span className="mb-1 block text-[var(--muted)]">
                          {colorRoleLabels[color.role]}
                        </span>
                        <input
                          type="color"
                          value={color.hex}
                          onChange={(e) =>
                            setBrand((cur) => ({
                              ...cur,
                              color_palette: cur.color_palette.map((item, i) =>
                                i === index ? { ...item, hex: e.target.value } : item,
                              ),
                            }))
                          }
                          className="h-9 w-full cursor-pointer rounded border-0 bg-transparent p-0"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <h2 className="mb-3 text-sm font-bold">פרטים רשמיים למסמכים</h2>
                  <Field label="שם רשמי">
                    <input className={inputCls} value={brand.official_name} onChange={(e) => setBrand((cur) => ({ ...cur, official_name: e.target.value }))} />
                  </Field>
                  <Field label="שם קצר">
                    <input className={inputCls} value={brand.short_name} onChange={(e) => setBrand((cur) => ({ ...cur, short_name: e.target.value }))} />
                  </Field>
                  <Field label="סלוגן">
                    <input className={inputCls} value={brand.slogan} onChange={(e) => setBrand((cur) => ({ ...cur, slogan: e.target.value }))} />
                  </Field>
                  <Field label="שם מחלקה">
                    <input className={inputCls} value={brand.department_name} onChange={(e) => setBrand((cur) => ({ ...cur, department_name: e.target.value }))} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="טלפון">
                      <input className={inputCls} value={brand.phone} onChange={(e) => setBrand((cur) => ({ ...cur, phone: e.target.value }))} />
                    </Field>
                    <Field label="מייל">
                      <input className={inputCls} dir="ltr" value={brand.email} onChange={(e) => setBrand((cur) => ({ ...cur, email: e.target.value }))} />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="פקס">
                      <input className={inputCls} dir="ltr" value={brand.fax} onChange={(e) => setBrand((cur) => ({ ...cur, fax: e.target.value }))} />
                    </Field>
                    <Field label="ח.פ / עמותה / מזהה רשות">
                      <input className={inputCls} dir="ltr" value={brand.legal_id} onChange={(e) => setBrand((cur) => ({ ...cur, legal_id: e.target.value }))} />
                    </Field>
                  </div>
                  <Field label="כתובת">
                    <input className={inputCls} value={brand.address} onChange={(e) => setBrand((cur) => ({ ...cur, address: e.target.value }))} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="איש קשר">
                      <input className={inputCls} value={brand.contact_person_name} onChange={(e) => setBrand((cur) => ({ ...cur, contact_person_name: e.target.value }))} />
                    </Field>
                    <Field label="תפקיד איש קשר">
                      <input className={inputCls} value={brand.contact_person_title} onChange={(e) => setBrand((cur) => ({ ...cur, contact_person_title: e.target.value }))} />
                    </Field>
                  </div>
                  <Field label="אתר">
                    <input className={inputCls} dir="ltr" value={brand.website} onChange={(e) => setBrand((cur) => ({ ...cur, website: e.target.value }))} />
                  </Field>
                  <Field label="מספר טופס ברירת מחדל">
                    <input className={inputCls} dir="ltr" value={brand.default_form_number} onChange={(e) => setBrand((cur) => ({ ...cur, default_form_number: e.target.value }))} />
                  </Field>
                  <Field label="טקסט קבוע לפוטר מסמכים">
                    <textarea className={`${inputCls} min-h-20 resize-y`} value={brand.document_footer_text} onChange={(e) => setBrand((cur) => ({ ...cur, document_footer_text: e.target.value }))} />
                  </Field>
                  <Field label="נוסח משפטי / הצהרה קבועה">
                    <textarea className={`${inputCls} min-h-20 resize-y`} value={brand.legal_disclaimer} onChange={(e) => setBrand((cur) => ({ ...cur, legal_disclaimer: e.target.value }))} />
                  </Field>
                  <Field label="נוסח חתימה">
                    <input className={inputCls} value={brand.signature_label} onChange={(e) => setBrand((cur) => ({ ...cur, signature_label: e.target.value }))} />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="פונט כותרות">
                      <select className={inputCls} value={brand.title_font_family} onChange={(e) => setBrand((cur) => ({ ...cur, title_font_family: e.target.value }))}>
                        {fontOptions.map((font) => <option key={font} value={font}>{font}</option>)}
                      </select>
                    </Field>
                    <Field label="פונט טקסט">
                      <select className={inputCls} value={brand.body_font_family} onChange={(e) => setBrand((cur) => ({ ...cur, body_font_family: e.target.value }))}>
                        {fontOptions.map((font) => <option key={font} value={font}>{font}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="סגנון מסמך">
                      <select className={inputCls} value={brand.document_style} onChange={(e) => setBrand((cur) => ({ ...cur, document_style: e.target.value as BrandDetails['document_style'] }))}>
                        <option value="official">רשמי</option>
                        <option value="modern">מודרני</option>
                        <option value="municipal">עירוני / רשותי</option>
                        <option value="legal">משפטי</option>
                        <option value="commercial">מסחרי</option>
                      </select>
                    </Field>
                    <Field label="שימוש במסמך">
                      <select className={inputCls} value={brand.document_usage} onChange={(e) => setBrand((cur) => ({ ...cur, document_usage: e.target.value as BrandDetails['document_usage'] }))}>
                        <option value="print">הדפסה</option>
                        <option value="digital">דיגיטלי</option>
                        <option value="both">הדפסה ודיגיטל</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mb-3 grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                      <span>הצגת רקע / סימן מים מותגי</span>
                      <input type="checkbox" checked={brand.show_brand_background} onChange={(e) => setBrand((cur) => ({ ...cur, show_brand_background: e.target.checked }))} />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                      <span>הצגת פוטר פרטי קשר</span>
                      <input type="checkbox" checked={brand.show_contact_footer} onChange={(e) => setBrand((cur) => ({ ...cur, show_contact_footer: e.target.checked }))} />
                    </label>
                  </div>
                </div>

                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <h2 className="mb-1 text-sm font-bold">אזור תוכן — מוח עסקי</h2>
                  <p className="mb-3 text-xs leading-5 text-[var(--muted)]">
                    כל התוכן הקיים של המותג מופיע כאן. אפשר לערוך, להוסיף או למחוק — הכול נשמר על המותג המשותף ויופיע
                    לכל מי שמשויך אליו, ומשמש את המערכת לעובדות, מסרים וניסוחים בתוצרים.
                  </p>

                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {CONTENT_SECTIONS.filter(
                      (section) => !contentSources.some((source) => source.title.trim() === section.title),
                    ).map((section) => (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() =>
                          setContentSources((cur) => [...cur, { title: section.title, content: '' }])
                        }
                        className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:border-brand hover:text-brand"
                      >
                        + {section.title}
                      </button>
                    ))}
                  </div>

                  {contentSources.length === 0 ? (
                    <p className="mb-3 text-xs text-[var(--muted)]">
                      אין עדיין תוכן למותג. אפשר להוסיף מקור חדש או לבחור קטגוריה מהכפתורים שלמעלה.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {contentSources.map((source, index) => (
                        <div key={source.id ?? `new-${index}`} className="rounded-lg border border-[var(--border)] p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <input
                              className={`${inputCls} text-sm font-medium`}
                              dir="auto"
                              placeholder="שם המקור"
                              value={source.title}
                              onChange={(e) =>
                                setContentSources((cur) =>
                                  cur.map((item, i) => (i === index ? { ...item, title: e.target.value } : item)),
                                )
                              }
                            />
                            <button
                              type="button"
                              onClick={() => setContentSources((cur) => cur.filter((_, i) => i !== index))}
                              className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                            >
                              מחיקה
                            </button>
                          </div>
                          <textarea
                            className={`${inputCls} min-h-24 resize-y`}
                            dir="rtl"
                            placeholder="הדביקו כאן טקסט עסקי, שירותים, מסרים, FAQ או ניסוחים קיימים"
                            value={source.content}
                            onChange={(e) =>
                              setContentSources((cur) =>
                                cur.map((item, i) => (i === index ? { ...item, content: e.target.value } : item)),
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setContentSources((cur) => [...cur, { title: '', content: '' }])}
                    className="mt-3 w-full rounded-lg border border-dashed border-[var(--border)] py-2 text-sm font-semibold text-[var(--muted)] hover:border-brand hover:text-brand"
                  >
                    + הוספת מקור תוכן
                  </button>
                </div>

                {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

                <button
                  onClick={saveBrandAndNext}
                  disabled={saving || brandLookupLoading}
                  className="mt-2 w-full rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {saving ? 'שומר...' : editingExistingBrand ? 'שמירת שינויים והמשך' : 'שמירת מותג והמשך'}
                </button>
              </section>
            )}

            {step === 'docs' && (
              <UploadStep
                title="מסמכי המותג"
                subtitle={`העלו מסמכים (DOCX / PDF)${brandName ? ` של ${brandName}` : ''} — נשתמש בתוכן שלהם כמאפייני המותג.`}
                accept=".docx,.pdf"
                items={docs}
                onFiles={(f) => uploadFiles('document', f)}
                hint="קבצי Word או PDF, עד 25MB."
              />
            )}

            {step === 'files' && (
              <UploadStep
                title="קבצים ותמונות"
                subtitle={`העלו תמונות וקבצים${brandName ? ` של ${brandName}` : ''} שיישמרו במערכת וישמשו בתוצרים.`}
                accept="image/*"
                items={assets}
                onFiles={(f) => uploadFiles('asset', f)}
                hint="תמונות (PNG / JPG / WEBP), עד 25MB לקובץ."
              />
            )}

            {(step === 'docs' || step === 'files') && (
              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                  className="text-sm font-medium text-[var(--muted)] hover:underline"
                >
                  חזרה
                </button>
                <div className="flex items-center gap-3">
                  {!requireUploads && (
                    <button onClick={advance} className="text-sm font-medium text-[var(--muted)] hover:underline">
                      דלג
                    </button>
                  )}
                  <button
                    onClick={advance}
                    disabled={!canLeaveStep || saving}
                    className="rounded-lg bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                  >
                    {stepIndex < steps.length - 1 ? 'המשך' : 'סיום וכניסה'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <AdminBottomNav isAdmin={isAdmin} canCreateOutputs={canCreateOutputs} onOpenMenu={() => setNavOpen(true)} />
      <InstallPrompt />
      {brandCandidatesOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="אישור בחירת מותג"
          dir="rtl"
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="סגירת בחירת מותג"
            onClick={() => setBrandCandidatesOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-[var(--border)] bg-white p-5 text-right shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">איזה מותג לבחור?</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">מצאנו כמה מותגים דומים לשם שהוקלד.</p>
              </div>
              <button
                type="button"
                onClick={() => setBrandCandidatesOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-lg text-[var(--muted)] hover:bg-gray-50"
                aria-label="סגירה"
              >
                ×
              </button>
            </div>
            <div className="space-y-2">
              {brandCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => confirmBrandCandidate(candidate)}
                  disabled={saving}
                  className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-white p-3 text-right hover:border-brand hover:bg-gray-50 disabled:opacity-60"
                >
                  <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--border)] bg-gray-50">
                    {candidate.logo_url ? (
                      <img src={candidate.logo_url} alt="" className="h-full w-full object-contain p-1" />
                    ) : (
                      <span className="text-xs font-bold text-brand">{candidate.name.slice(0, 2)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-[var(--text)]">{candidate.name}</div>
                    {candidate.style_notes && (
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{candidate.style_notes}</div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-brand">
                    בחירה
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-5 flex justify-start">
              <button
                type="button"
                onClick={() => {
                  setBrandCandidatesOpen(false);
                  setBrandCandidates([]);
                  setBrandMode('new');
                }}
                className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
              >
                זה מותג חדש
              </button>
            </div>
          </div>
        </div>
      )}
      {avatarModalOpen && avatarPreview && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="תמונת פרופיל"
          dir="rtl"
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="סגירת תמונת פרופיל"
            onClick={() => setAvatarModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-5 text-right shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">תמונת פרופיל</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">אפשר להחליף את התמונה לפני שממשיכים.</p>
              </div>
              <button
                type="button"
                onClick={() => setAvatarModalOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-lg text-[var(--muted)] hover:bg-gray-50"
                aria-label="סגירה"
              >
                ×
              </button>
            </div>
            <div className="mx-auto grid h-56 w-56 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-gray-50">
              <img src={avatarPreview} alt="תמונת פרופיל" className="h-full w-full object-cover" />
            </div>
            <div className="mt-5 flex justify-start gap-3">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                החלפת תמונה
              </button>
              <button
                type="button"
                onClick={() => setAvatarModalOpen(false)}
                className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
              >
                סגירה
              </button>
            </div>
          </div>
        </div>
      )}
      {brandColorModalOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="זיהוי צבעי מותג"
          dir="rtl"
        >
          <button
            type="button"
            className="absolute inset-0 z-0 h-full w-full cursor-default"
            aria-label="סגירת מודל זיהוי צבעי מותג"
            onClick={() => setBrandColorModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-[var(--border)] bg-white p-5 text-right shadow-xl" dir="rtl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">זיהוי צבעי מותג</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  ה-AI ינתח את הלוגו ויחלץ את צבעי המותג המרכזיים לשימוש במערכת.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBrandColorModalOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-lg text-[var(--muted)] hover:bg-gray-50"
                aria-label="סגירה"
              >
                ×
              </button>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-gray-50 p-4">
              <div className="text-sm font-semibold text-[var(--text)]">מה יקרה</div>
              <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                <li>• המערכת תנתח את הלוגו או הקובץ שהועלה.</li>
                <li>• הצבעים יישמרו כצבעי מותג ראשי, משני, הדגשה, רקע וטקסט.</li>
                <li>• כל הרצה תתועד ביומן הפעולות של ה-AI, כולל עלות.</li>
              </ul>
            </div>

            {brandColorSummary && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                {brandColorSummary}
              </div>
            )}

            {brandColorAnalysis && (
              <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-[var(--border)] p-4 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-[var(--muted)]">עלות</div>
                  <div className="font-semibold ltr">${brandColorAnalysis.estimated_cost.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-[var(--muted)]">ביטחון</div>
                  <div className="font-semibold">{Math.round(brandColorAnalysis.confidence * 100)}%</div>
                </div>
                <div>
                  <div className="text-[var(--muted)]">מודל</div>
                  <div className="font-semibold ltr">{brandColorAnalysis.model}</div>
                </div>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4">
              <div className="text-sm font-semibold">יומן פעולה</div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                זיהוי צבעי מותג נרשם בפעולות AI כך שאפשר לעקוב אחרי שימוש, עלות ותוצאה.
              </p>
            </div>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={analyzeBrandColors}
                disabled={brandColorAnalyzing}
                className="flex-1 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {brandColorAnalyzing ? 'מזהה צבעים...' : 'להפעיל זיהוי'}
              </button>
              <button
                type="button"
                onClick={() => setBrandColorModalOpen(false)}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadStep({
  title,
  subtitle,
  accept,
  items,
  onFiles,
  hint,
}: {
  title: string;
  subtitle: string;
  accept: string;
  items: UploadedItem[];
  onFiles: (files: FileList | null) => void;
  hint: string;
}) {
  return (
    <section>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mb-4 mt-1 text-sm text-[var(--muted)]">{subtitle}</p>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--border)] bg-gray-50 px-4 py-8 text-center hover:bg-gray-100">
        <span className="text-sm font-medium">לחצו לבחירת קבצים</span>
        <span className="text-xs text-[var(--muted)]">{hint}</span>
        <input
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.map((it, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              <span className="truncate">{it.name}</span>
              <span className="shrink-0 text-xs">
                {it.status === 'uploading' && <span className="text-[var(--muted)]">מעלה…</span>}
                {it.status === 'done' && <span className="text-green-600">✓ נשמר</span>}
                {it.status === 'error' && <span className="text-red-600">{it.error ?? 'שגיאה'}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stepper({ steps, current }: { steps: StepKey[]; current: number }) {
  const labels: Record<StepKey, string> = { details: 'פרטים', brand: 'מותג', docs: 'מסמכים', files: 'קבצים' };
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                i <= current ? 'bg-brand text-white' : 'bg-gray-200 text-[var(--muted)]'
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm ${i === current ? 'font-semibold' : 'text-[var(--muted)]'}`}>
              {labels[s]}
            </span>
          </div>
          {i < steps.length - 1 && <span className="h-px w-6 bg-[var(--border)]" />}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function GenderOption({
  value,
  selected,
  onChange,
  label,
}: {
  value: ProfileGender;
  selected: ProfileGender | '';
  onChange: (value: ProfileGender) => void;
  label: string;
}) {
  const isSelected = selected === value;
  return (
    <label
      className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium ${
        isSelected
          ? 'border-brand bg-blue-50 text-brand'
          : 'border-[var(--border)] bg-white text-[var(--text)] hover:bg-gray-50'
      }`}
    >
      <input
        type="radio"
        name="gender"
        value={value}
        checked={isSelected}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {label}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

function brandFromRow(row: Partial<BrandDetails>): BrandDetails {
  // Collapse to exactly the five standard roles, in a fixed order, taking the first
  // hex seen per role. Brands may carry duplicate or partial palettes, which would
  // otherwise produce duplicate React keys and broken swatches in the editor.
  const hexByRole = new Map<BrandDetails['color_palette'][number]['role'], string>();
  if (Array.isArray(row.color_palette)) {
    for (const color of row.color_palette) {
      const role = color?.role;
      if (
        typeof color?.hex === 'string' &&
        (role === 'primary' || role === 'secondary' || role === 'accent' || role === 'background' || role === 'text') &&
        !hexByRole.has(role)
      ) {
        hexByRole.set(role, color.hex);
      }
    }
  }
  const normalizedPalette = emptyBrand.color_palette.map((color) => ({
    role: color.role,
    hex: hexByRole.get(color.role) ?? color.hex,
  }));

  return {
    ...emptyBrand,
    ...row,
    name: row.name ?? '',
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    style_notes: row.style_notes ?? '',
    client_type: row.client_type === 'municipality' ? 'municipality' : 'business',
    color_palette: normalizedPalette,
    logo_path: row.logo_path ?? null,
    logo_url: row.logo_url ?? null,
    official_name: row.official_name ?? '',
    short_name: row.short_name ?? '',
    slogan: row.slogan ?? '',
    department_name: row.department_name ?? '',
    contact_person_name: row.contact_person_name ?? '',
    contact_person_title: row.contact_person_title ?? '',
    address: row.address ?? '',
    phone: row.phone ?? '',
    fax: row.fax ?? '',
    email: row.email ?? '',
    website: row.website ?? '',
    legal_id: row.legal_id ?? '',
    default_form_number: row.default_form_number ?? '',
    document_footer_text: row.document_footer_text ?? '',
    legal_disclaimer: row.legal_disclaimer ?? '',
    signature_label: row.signature_label ?? '',
    title_font_family: row.title_font_family ?? 'Assistant',
    body_font_family: row.body_font_family ?? 'Assistant',
    document_style:
      row.document_style === 'modern' ||
      row.document_style === 'municipal' ||
      row.document_style === 'legal' ||
      row.document_style === 'commercial'
        ? row.document_style
        : 'official',
    show_brand_background: row.show_brand_background !== false,
    show_contact_footer: row.show_contact_footer !== false,
    document_usage:
      row.document_usage === 'digital' || row.document_usage === 'both' ? row.document_usage : 'print',
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').pop() ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').pop() ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
