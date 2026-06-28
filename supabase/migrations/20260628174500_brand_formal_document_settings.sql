-- ============================================================================
-- Formal document settings per brand
-- ----------------------------------------------------------------------------
-- Adds optional fields used by official-looking PDF/form templates and lets a
-- regular brand member update only those formal document fields. Admins keep
-- full control over the complete brand kit.
-- ============================================================================

alter table public.brands
  add column if not exists official_name text,
  add column if not exists short_name text,
  add column if not exists slogan text,
  add column if not exists department_name text,
  add column if not exists contact_person_name text,
  add column if not exists contact_person_title text,
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists fax text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists legal_id text,
  add column if not exists default_form_number text,
  add column if not exists document_footer_text text,
  add column if not exists legal_disclaimer text,
  add column if not exists signature_label text,
  add column if not exists title_font_family text,
  add column if not exists body_font_family text,
  add column if not exists document_style text,
  add column if not exists show_brand_background boolean not null default true,
  add column if not exists show_contact_footer boolean not null default true,
  add column if not exists document_usage text default 'print';

alter table public.brands
  drop constraint if exists brands_document_style_check,
  add constraint brands_document_style_check
    check (document_style is null or document_style in ('official', 'modern', 'municipal', 'legal', 'commercial'));

alter table public.brands
  drop constraint if exists brands_document_usage_check,
  add constraint brands_document_usage_check
    check (document_usage is null or document_usage in ('print', 'digital', 'both'));

comment on column public.brands.official_name is 'Official legal/display name used in formal documents and PDF forms.';
comment on column public.brands.document_footer_text is 'Optional fixed footer text for official brand documents.';
comment on column public.brands.legal_disclaimer is 'Optional fixed legal/administrative wording for official forms.';

create or replace function public.prevent_regular_brand_core_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.name is distinct from old.name
    or new.aliases is distinct from old.aliases
    or new.logo_path is distinct from old.logo_path
    or new.color_palette is distinct from old.color_palette
    or new.style_notes is distinct from old.style_notes
    or new.is_active is distinct from old.is_active
    or new.client_type is distinct from old.client_type
    or new.created_by is distinct from old.created_by then
    raise exception 'Regular users may update only formal document brand fields';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_regular_brand_core_changes() from public;
revoke all on function public.prevent_regular_brand_core_changes() from anon;
revoke all on function public.prevent_regular_brand_core_changes() from authenticated;

drop trigger if exists prevent_regular_brand_core_changes on public.brands;
create trigger prevent_regular_brand_core_changes
  before update on public.brands
  for each row execute function public.prevent_regular_brand_core_changes();

drop policy if exists "brands_user_allowed_formal_update" on public.brands;
create policy "brands_user_allowed_formal_update" on public.brands
  for update to authenticated
  using (
    exists (
      select 1 from public.user_brands ub
      where ub.brand_id = brands.id
        and ub.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.user_brands ub
      where ub.brand_id = brands.id
        and ub.user_id = (select auth.uid())
    )
  );
