-- =========================================================
-- My Study Notes — Supabase schema & RLS
-- انسخ هذا الملف والصقه في: Supabase Dashboard -> SQL Editor -> Run
-- =========================================================

-- 1) جدول المذكرات
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null,
  lesson text not null,
  summary text,
  exam_date date,
  status text not null default 'good'
    check (status in ('excellent', 'good', 'review', 'weak')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) فهارس للأداء
create index if not exists notes_user_id_idx on public.notes (user_id);
create index if not exists notes_created_at_idx on public.notes (created_at desc);

-- 3) تفعيل الحماية (Row Level Security)
alter table public.notes enable row level security;

-- 4) سياسات RLS: كل مستخدم يرى/يعدّل مذكراته فقط
drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own"
  on public.notes for select
  using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own"
  on public.notes for insert
  with check (auth.uid() = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own"
  on public.notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own"
  on public.notes for delete
  using (auth.uid() = user_id);

-- 5) تحديث updated_at تلقائيًا
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
before update on public.notes
for each row
execute function public.set_updated_at();

-- (اختياري) تأكد من أن البريد مطلوب في Supabase Auth:
-- Authentication -> Providers -> Email -> Confirm email (يمكن تعطيله للتجربة)
