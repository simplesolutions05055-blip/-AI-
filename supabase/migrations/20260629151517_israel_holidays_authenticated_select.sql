drop policy if exists "israel_holidays_authenticated_select" on public.israel_holidays;
create policy "israel_holidays_authenticated_select" on public.israel_holidays
  for select to authenticated
  using (true);
