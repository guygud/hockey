-- Рейтинг: лучший счёт по голам. Выполнить в SQL Editor проекта Supabase.

create table if not exists public.scores (
  player_id text primary key,
  name text not null,
  goals int not null default 0 check (goals >= 0),
  updated_at timestamptz not null default now()
);

alter table public.scores enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on table public.scores to anon, authenticated;

drop policy if exists scores_select on public.scores;
create policy scores_select
  on public.scores
  for select
  to anon, authenticated
  using (true);

drop policy if exists scores_insert on public.scores;
create policy scores_insert
  on public.scores
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists scores_update on public.scores;
create policy scores_update
  on public.scores
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- Клиент может прислать меньший счёт — оставляем максимум.
create or replace function public.scores_keep_best()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.goals < old.goals then
    new.goals := old.goals;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists scores_keep_best on public.scores;
create trigger scores_keep_best
  before insert or update on public.scores
  for each row
  execute function public.scores_keep_best();
