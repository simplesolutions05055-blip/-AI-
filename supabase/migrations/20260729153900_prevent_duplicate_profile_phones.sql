-- Phone values are normalized by onboarding to 05XXXXXXXX. NULL remains
-- allowed for profiles that have not completed the phone step yet.
create unique index if not exists profiles_phone_unique_idx
  on public.profiles (phone)
  where phone is not null;
