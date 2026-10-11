create table public.teacher_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', created_at timestamptz not null default now()
);
create table public.classes (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
 school text not null default '', school_id text not null default '', region text not null default '', division text not null default '',
 teacher text not null default '', grade_level text not null default '', section text not null,
 school_year text not null, subject text not null, cluster text not null default '', subject_category text not null default '',
 revision bigint not null default 0, archived boolean not null default false, created_at timestamptz not null default now()
);
create table public.class_enrollments (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
 name text not null check(length(trim(name))>0), lrn text check(lrn is null or lrn ~ '^[0-9]{12}$'),
 sex text not null default 'unspecified', source_key text, unique(id,class_id), unique(class_id,lrn)
);
create table public.terms (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
 number integer not null check(number between 1 and 3), units numeric not null check(units>0), unique(class_id,number), unique(id,class_id)
);
create table public.assessment_categories (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
 code text not null check(code in ('ww','pt','ex')), label text not null, unique(class_id,code), unique(id,class_id)
);
create table public.assessments (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
 term_id uuid not null, category_id uuid not null, source_key text not null, name text not null check(length(trim(name))>0),
 maximum numeric not null check(maximum>0 and maximum<=1000000), subcomponent text check(subcomponent in ('ST1','ST2','TE')),
 ordinal integer not null default 0, unique(class_id,source_key), unique(id,class_id),
 foreign key(term_id,class_id) references public.terms(id,class_id), foreign key(category_id,class_id) references public.assessment_categories(id,class_id)
);
create unique index unique_exam on public.assessments(class_id,term_id,subcomponent) where subcomponent is not null;
create table public.scores (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
 enrollment_id uuid not null, assessment_id uuid not null, value numeric check(value is null or (value>=0 and value<=1000000)),
 version bigint not null default 1, updated_at timestamptz not null default now(),
 unique(enrollment_id,assessment_id), foreign key(enrollment_id,class_id) references public.class_enrollments(id,class_id) on delete cascade,
 foreign key(assessment_id,class_id) references public.assessments(id,class_id) on delete cascade
);
create table public.grading_configurations (
 class_id uuid primary key references public.classes(id) on delete cascade,
 rules_version text not null check(rules_version='salazar-v1'), resolved boolean not null default false,
 weights jsonb not null, subweights jsonb not null, applicable_terms integer[] not null,
 units_per_term numeric not null check(units_per_term>0), units_per_year numeric not null check(units_per_year>0),
 passing_threshold numeric not null check(passing_threshold between 0 and 100), confirmation text
);
create table public.transmutation_ranges (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.grading_configurations(class_id) on delete cascade,
 lower numeric not null check(lower>=0), upper numeric not null check(upper between 0 and 100 and upper>=lower),
 grade integer not null check(grade between 60 and 100), unique(class_id,upper), unique(class_id,grade)
);
create table public.descriptors (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.grading_configurations(class_id) on delete cascade,
 grade integer not null check(grade between 60 and 100), label text not null check(length(trim(label))>0), unique(class_id,grade)
);
create table public.import_batches (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id), confirmation_token uuid not null,
 filename text not null, fingerprint text not null, payload_hash text not null, strategy text not null,
 summary jsonb not null default '{}', created_at timestamptz not null default now(), unique(owner_id,confirmation_token),unique(id,class_id)
);
create table public.import_provenance (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
 batch_id uuid not null, kind text not null, record_key text not null, sheet text not null, cell text not null,
 formula text, cached jsonb, foreign key(batch_id,class_id) references public.import_batches(id,class_id) on delete cascade
);
create index classes_owner on public.classes(owner_id);
create index scores_class on public.scores(class_id);
create index provenance_batch on public.import_provenance(batch_id);
create function public.owns_class(p_class uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.classes where id=p_class and owner_id=auth.uid());
$$;
create function public.profile_on_signup() returns trigger language plpgsql security definer set search_path='' as $$
 begin insert into public.teacher_profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',''));return new;end;
$$;
create trigger signup_profile after insert on auth.users for each row execute function public.profile_on_signup();
alter table public.teacher_profiles enable row level security;
create policy profile_access on public.teacher_profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
alter table public.classes enable row level security;
create policy classes_access on public.classes for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
do $$ declare t text; begin
 foreach t in array array['class_enrollments','terms','assessment_categories','assessments','scores','grading_configurations','transmutation_ranges','descriptors','import_batches','import_provenance'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owned_class on public.%I for select to authenticated using(public.owns_class(class_id))',t);
 end loop;
end $$;
-- All child mutations use validated RPCs. RLS is an additional read boundary.
revoke all on public.teacher_profiles,public.classes,public.class_enrollments,public.terms,public.assessment_categories,public.assessments,public.scores,public.grading_configurations,public.transmutation_ranges,public.descriptors,public.import_batches,public.import_provenance from anon;
grant select on public.teacher_profiles,public.classes,public.class_enrollments,public.terms,public.assessment_categories,public.assessments,public.scores,public.grading_configurations,public.transmutation_ranges,public.descriptors,public.import_batches,public.import_provenance to authenticated;
grant insert,update on public.teacher_profiles to authenticated;
-- Classes also mutate through RPC to prevent revision/owner spoofing.
revoke insert,update,delete on public.classes from authenticated;
revoke all on function public.profile_on_signup() from public,anon,authenticated;
revoke all on function public.owns_class(uuid) from public,anon;
grant execute on function public.owns_class(uuid) to authenticated;
