-- =====================================================================
--  Inventaire GéoConsulting — installation de la base Supabase
--  À coller en une seule fois dans : Supabase > SQL Editor > New query > Run
--  Le script peut être relancé sans risque (il ne supprime aucune donnée).
-- =====================================================================

-- 1. Profils des utilisateurs (nom affiché dans l'application) ----------
create table if not exists public.profils (
  id         uuid primary key references auth.users (id) on delete cascade,
  nom        text not null default '',
  cree_le    timestamptz not null default now()
);

-- Crée automatiquement un profil quand un compte est ajouté dans Supabase
create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profils (id, nom)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nom', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists apres_creation_compte on auth.users;
create trigger apres_creation_compte
  after insert on auth.users
  for each row execute function public.creer_profil();

-- Profils des comptes qui existaient déjà avant ce script
insert into public.profils (id, nom)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;


-- 2. Fiches de matériel ---------------------------------------------------
create table if not exists public.materiel (
  id                   text primary key check (id ~ '^GC-[A-Z0-9]{5}$'),
  designation          text not null check (length(trim(designation)) > 0),
  categorie            text not null default '',
  marque               text not null default '',
  modele               text not null default '',
  numero_serie         text not null default '',
  accessoires          text not null default '',
  etat                 text not null default 'À vérifier'
                         check (etat in ('Fonctionnel', 'À vérifier', 'En réparation', 'En panne')),
  quantite             integer not null default 1 check (quantite >= 1),
  site                 text not null default '',
  emplacement          text not null default '',
  etalonnage_dernier   date,
  etalonnage_prochain  date,
  remarques            text not null default '',
  a_confirmer          boolean not null default false,
  photos               jsonb not null default '{}'::jsonb,   -- { "main": "chemin", "plate": "...", "other": "..." }
  miniature            text not null default '',             -- petite image (data URL) pour la liste
  origine              text not null default '',             -- fichier / feuille d'origine pour les fiches importées
  cree_par             uuid references auth.users (id) on delete set null default auth.uid(),
  modifie_par          uuid references auth.users (id) on delete set null default auth.uid(),
  cree_le              timestamptz not null default now(),
  modifie_le           timestamptz not null default now()
);

create index if not exists materiel_modifie_le_idx on public.materiel (modifie_le desc);
create index if not exists materiel_numero_serie_idx on public.materiel (numero_serie);

-- Date de modification et auteur mis à jour automatiquement
create or replace function public.maj_materiel()
returns trigger
language plpgsql
as $$
begin
  new.modifie_le := now();
  new.modifie_par := coalesce(auth.uid(), new.modifie_par);
  new.cree_le := old.cree_le;
  new.cree_par := old.cree_par;
  return new;
end;
$$;

drop trigger if exists avant_maj_materiel on public.materiel;
create trigger avant_maj_materiel
  before update on public.materiel
  for each row execute function public.maj_materiel();


-- 3. Sécurité : seuls les comptes connectés accèdent aux données ----------
alter table public.profils  enable row level security;
alter table public.materiel enable row level security;

drop policy if exists "profils_lecture"      on public.profils;
drop policy if exists "profils_maj_soi"      on public.profils;
create policy "profils_lecture" on public.profils
  for select to authenticated using (true);
create policy "profils_maj_soi" on public.profils
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "materiel_lecture"     on public.materiel;
drop policy if exists "materiel_ajout"       on public.materiel;
drop policy if exists "materiel_modif"       on public.materiel;
drop policy if exists "materiel_suppression" on public.materiel;
create policy "materiel_lecture"     on public.materiel for select to authenticated using (true);
create policy "materiel_ajout"       on public.materiel for insert to authenticated with check (true);
create policy "materiel_modif"       on public.materiel for update to authenticated using (true) with check (true);
create policy "materiel_suppression" on public.materiel for delete to authenticated using (true);


-- Droits d'accès explicites (utile si l'option « exposer automatiquement
-- les nouvelles tables » a été décochée à la création du projet)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.materiel to authenticated;
grant select, update on public.profils to authenticated;
revoke all on public.materiel from anon;
revoke all on public.profils from anon;


-- 4. Mise à jour en temps réel sur tous les téléphones --------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'materiel'
  ) then
    alter publication supabase_realtime add table public.materiel;
  end if;
end $$;


-- 5. Stockage des photos (espace privé « photos ») ------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "photos_lecture"     on storage.objects;
drop policy if exists "photos_ajout"       on storage.objects;
drop policy if exists "photos_modif"       on storage.objects;
drop policy if exists "photos_suppression" on storage.objects;
create policy "photos_lecture"     on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "photos_ajout"       on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "photos_modif"       on storage.objects for update to authenticated using (bucket_id = 'photos');
create policy "photos_suppression" on storage.objects for delete to authenticated using (bucket_id = 'photos');

-- Terminé. Vérifiez dans « Table Editor » que les tables materiel et profils existent.
