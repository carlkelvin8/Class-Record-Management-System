-- Initial setup for an empty Supabase project.
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


create function public.validate_grading_config(c jsonb) returns void language plpgsql set search_path='' as $$
declare w numeric; sw numeric; n integer;
begin
 if c is null or not c ?& array['rules_version','resolved','weights','subweights','applicable_terms','units_per_term','units_per_year','passing_threshold','ranges','descriptors'] or jsonb_typeof(c)<>'object' or c->>'rules_version'<>'salazar-v1' then raise exception 'Unsupported grading configuration';end if;
 if jsonb_typeof(c->'weights')<>'object' or jsonb_typeof(c->'subweights')<>'object' or jsonb_typeof(c->'applicable_terms')<>'array' or jsonb_typeof(c->'ranges')<>'array' or jsonb_typeof(c->'descriptors')<>'array' or c->>'units_per_term' is null or c->>'units_per_year' is null or c->>'passing_threshold' is null or jsonb_typeof(c->'resolved')<>'boolean' then raise exception 'resolved must be boolean';end if;
 if (select count(*) from jsonb_object_keys(c->'weights'))<>3 or (select count(*) from jsonb_object_keys(c->'subweights'))<>3 then raise exception 'Invalid weight keys';end if;
 select sum(value::numeric) into w from jsonb_each_text(c->'weights');
 select sum(value::numeric) into sw from jsonb_each_text(c->'subweights');
 if w is distinct from 100 or (c->'weights'->>'ex')::numeric>0 and sw is distinct from 100 then raise exception 'Weights must total 100';end if;
 if not c->'weights' ?& array['ww','pt','ex'] or not c->'subweights' ?& array['ST1','ST2','TE'] or exists(select 1 from jsonb_each_text(c->'weights') where value is null or value::numeric<0 or value::numeric>100 or value::numeric='NaN'::numeric) or exists(select 1 from jsonb_each_text(c->'subweights') where value is null or value::numeric<0 or value::numeric>100 or value::numeric='NaN'::numeric) then raise exception 'Invalid weight';end if;
 n:=jsonb_array_length(c->'applicable_terms');
 if n not between 1 and 3 or exists(select 1 from jsonb_array_elements_text(c->'applicable_terms') t where t::integer not between 1 and 3) or (select count(distinct value) from jsonb_array_elements_text(c->'applicable_terms'))<>n then raise exception 'Invalid terms';end if;
 if (c->>'units_per_term')::numeric>1000000 or (c->>'units_per_term')::numeric<=0 or (c->>'units_per_year')::numeric<>(c->>'units_per_term')::numeric*n or (c->>'units_per_term')::numeric='NaN'::numeric or (c->>'passing_threshold')::numeric not between 0 and 100 then raise exception 'Invalid units/threshold';end if;
 if jsonb_array_length(c->'ranges')<>41 or (select count(distinct value->>'upper') from jsonb_array_elements(c->'ranges'))<>41 or (select count(distinct value->>'grade') from jsonb_array_elements(c->'ranges'))<>41 then raise exception 'Expected 41 unique transmutation rows';end if;
 if exists(select 1 from jsonb_array_elements(c->'ranges') r where (r->>'lower')::numeric<0 or (r->>'upper')::numeric<(r->>'lower')::numeric or (r->>'upper')::numeric>100 or (r->>'grade')::integer not between 60 and 100 or r->>'upper' is null or r->>'lower' is null or r->>'grade' is null) then raise exception 'Invalid transmutation range';end if;
 if jsonb_array_length(c->'descriptors')<>41 or (select count(distinct value->>'grade') from jsonb_array_elements(c->'descriptors'))<>41 or exists(select 1 from jsonb_array_elements(c->'descriptors') d where (d->>'grade')::integer not between 60 and 100 or coalesce(length(trim(d->>'label')),0)=0) then raise exception 'Invalid descriptors';end if;
end;
$$;
-- PostgreSQL lacks jsonb_object_length; count keys with a small SQL helper.

create function public.config_json(p_class uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('rules_version',c.rules_version,'resolved',c.resolved,'weights',c.weights,'subweights',c.subweights,
 'applicable_terms',to_jsonb(c.applicable_terms),'units_per_term',c.units_per_term,'units_per_year',c.units_per_year,'passing_threshold',c.passing_threshold,'confirmation',c.confirmation,
 'ranges',(select jsonb_agg(jsonb_build_object('lower',r.lower,'upper',r.upper,'grade',r.grade) order by r.grade desc) from public.transmutation_ranges r where r.class_id=c.class_id),
 'descriptors',(select jsonb_agg(jsonb_build_object('grade',d.grade,'label',d.label) order by d.grade desc) from public.descriptors d where d.class_id=c.class_id))
 from public.grading_configurations c where c.class_id=p_class;
$$;
create function public.grade_rules(c jsonb, inputs jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare category text; sub text; components jsonb:='{}'; exam jsonb:='{"ST1":null,"ST2":null,"TE":null}'; a jsonb;
 total numeric; maximum numeric; ps numeric; ws numeric; part numeric; exsum numeric:=0; exentered integer:=0; entered integer; active integer; missing integer;
 inc boolean:=false; ig numeric; tg integer; provisional boolean; weight numeric; subweight numeric;
begin
 foreach category in array array['ww','pt','ex'] loop
  select sum((i->>'maximum')::numeric),sum((i->>'value')::numeric),count(*) filter(where i->>'value' is not null),count(*),count(*) filter(where i->>'value' is null)
  into maximum,total,entered,active,missing from jsonb_array_elements(inputs) i where i->>'category'=category and (i->>'maximum')::numeric>0;
  maximum:=coalesce(maximum,0);weight:=(c->'weights'->>category)::numeric;ps:=null;ws:=null;
  if entered=0 then total:=null;end if;
  if weight>0 and (active=0 or missing>0) then inc:=true;end if;
  if category='ex' then
   foreach sub in array array['ST1','ST2','TE'] loop
    subweight:=(c->'subweights'->>sub)::numeric;
    a:=null;select i into a from jsonb_array_elements(inputs) i where i->>'category'='ex' and i->>'subcomponent'=sub and (i->>'maximum')::numeric>0 limit 1;
    part:=null;
    if weight>0 and subweight>0 and (a is null or a->>'value' is null) then inc:=true;end if;
    if a is not null and a->>'value' is not null then part:=round((a->>'value')::numeric/(a->>'maximum')::numeric*subweight,2);exsum:=exsum+part;exentered:=exentered+1;end if;
    exam:=exam||jsonb_build_object(sub,part);
   end loop;
   if weight>0 and exentered>0 and ((c->'subweights'->>'ST1')::numeric+(c->'subweights'->>'ST2')::numeric+(c->'subweights'->>'TE')::numeric)>0 then
    ps:=exsum/((c->'subweights'->>'ST1')::numeric+(c->'subweights'->>'ST2')::numeric+(c->'subweights'->>'TE')::numeric)*100;
   end if;
  elsif total is not null and maximum>0 then ps:=round(total/maximum*100,2);end if;
  if ps is not null then ws:=round(ps*weight/100,2);end if;
  components:=components||jsonb_build_object(category,jsonb_build_object('total',total,'maximum',maximum,'ps',ps,'ws',ws));
 end loop;
 if components->'ww'->>'ws' is not null and components->'pt'->>'ws' is not null and ((c->'weights'->>'ex')::numeric=0 or components->'ex'->>'ws' is not null) then
  ig:=(components->'ww'->>'ws')::numeric+(components->'pt'->>'ws')::numeric+coalesce((components->'ex'->>'ws')::numeric,0);
 end if;
 if ig is not null and (c->>'resolved')::boolean then select (r->>'grade')::integer into tg from jsonb_array_elements(c->'ranges') r where (r->>'upper')::numeric>=ig order by (r->>'upper')::numeric limit 1;end if;
 provisional:=not (c->>'resolved')::boolean or (ig is not null and tg is null);
 return jsonb_build_object('components',components,'exam',exam,'initial',ig,'grade',tg,'incomplete',inc or ig is null,'provisional',provisional);
end;
$$;
create function public.calculate_term(p_class uuid,p_enrollment uuid,p_term uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.grade_rules(public.config_json(p_class),coalesce(jsonb_agg(jsonb_build_object('category',ac.code,'subcomponent',a.subcomponent,'maximum',a.maximum,'value',s.value)) filter(where a.id is not null),'[]'))
 from public.assessments a join public.assessment_categories ac on ac.id=a.category_id
 left join public.scores s on s.assessment_id=a.id and s.enrollment_id=p_enrollment
 where a.class_id=p_class and a.term_id=p_term;
$$;
create view public.term_grades with(security_invoker=true) as
 select e.class_id,e.id enrollment_id,t.id term_id,t.number,public.calculate_term(e.class_id,e.id,t.id) result
 from public.class_enrollments e join public.terms t on t.class_id=e.class_id;
create function public.final_rules(c jsonb,results jsonb,lrn text) returns jsonb language plpgsql immutable set search_path='' as $$
declare n integer; entered integer; total numeric; final numeric; inc boolean; provisional boolean; label text; remark text;
begin
 n:=jsonb_array_length(c->'applicable_terms');
 select count(*) filter(where r->>'grade' is not null),sum((r->>'grade')::numeric),coalesce(bool_or((r->>'incomplete')::boolean),true),coalesce(bool_or((r->>'provisional')::boolean),true)
 into entered,total,inc,provisional from jsonb_array_elements(results) r;
 inc:=inc or entered<>n;provisional:=provisional or not (c->>'resolved')::boolean or lrn is null;
 if entered=n and not provisional then final:=round(total*(c->>'units_per_term')::numeric/(c->>'units_per_year')::numeric,0);end if;
 if final is not null then select d->>'label' into label from jsonb_array_elements(c->'descriptors') d where (d->>'grade')::integer=final;end if;
 if final is not null and not inc and not provisional then remark:=case when final>=(c->>'passing_threshold')::numeric then 'PASSED' else 'FAILED' end;end if;
 return jsonb_build_object('final',final,'incomplete',inc,'provisional',provisional,'descriptor',label,'remark',remark);
end;
$$;
create view public.final_grades with(security_invoker=true) as
 select e.class_id,e.id enrollment_id,public.final_rules(public.config_json(e.class_id),coalesce((select jsonb_agg(t.result order by t.number) from public.term_grades t where t.enrollment_id=e.id),'[]'),e.lrn) result
 from public.class_enrollments e;
revoke all on function public.validate_grading_config(jsonb) from public,anon,authenticated;
revoke all on function public.config_json(uuid),public.grade_rules(jsonb,jsonb),public.calculate_term(uuid,uuid,uuid),public.final_rules(jsonb,jsonb,text) from public,anon;
grant execute on function public.config_json(uuid),public.grade_rules(jsonb,jsonb),public.calculate_term(uuid,uuid,uuid),public.final_rules(jsonb,jsonb,text) to authenticated;
grant select on public.term_grades,public.final_grades to authenticated;


create function public.store_config(p_class uuid,c jsonb) returns void language plpgsql set search_path='' as $$
#variable_conflict use_variable
declare r jsonb; t integer;
begin
 perform public.validate_grading_config(c);
 insert into public.grading_configurations(class_id,rules_version,resolved,weights,subweights,applicable_terms,units_per_term,units_per_year,passing_threshold,confirmation)
 values(p_class,c->>'rules_version',(c->>'resolved')::boolean,c->'weights',c->'subweights',array(select value::integer from jsonb_array_elements_text(c->'applicable_terms')),(c->>'units_per_term')::numeric,(c->>'units_per_year')::numeric,(c->>'passing_threshold')::numeric,c->>'confirmation')
 on conflict(class_id) do update set resolved=excluded.resolved,weights=excluded.weights,subweights=excluded.subweights,applicable_terms=excluded.applicable_terms,units_per_term=excluded.units_per_term,units_per_year=excluded.units_per_year,passing_threshold=excluded.passing_threshold,confirmation=excluded.confirmation;
 delete from public.transmutation_ranges where class_id=p_class;delete from public.descriptors where class_id=p_class;
 for r in select value from jsonb_array_elements(c->'ranges') loop insert into public.transmutation_ranges(class_id,lower,upper,grade) values(p_class,(r->>'lower')::numeric,(r->>'upper')::numeric,(r->>'grade')::integer);end loop;
 for r in select value from jsonb_array_elements(c->'descriptors') loop insert into public.descriptors(class_id,grade,label) values(p_class,(r->>'grade')::integer,r->>'label');end loop;
 foreach t in array array(select value::integer from jsonb_array_elements_text(c->'applicable_terms')) loop
 insert into public.terms(class_id,number,units) values(p_class,t,(c->>'units_per_term')::numeric) on conflict(class_id,number) do update set units=excluded.units;
 end loop;
 if exists(select 1 from public.assessments a join public.terms t on t.id=a.term_id where a.class_id=p_class and not t.number=any(array(select value::integer from jsonb_array_elements_text(c->'applicable_terms')))) then raise exception 'Cannot deactivate a term with assessments';end if;
 delete from public.terms where class_id=p_class and not number=any(array(select value::integer from jsonb_array_elements_text(c->'applicable_terms')));
end;
$$;
create function public.canonical_config(c jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('rules_version',c->'rules_version','resolved',c->'resolved','weights',c->'weights','subweights',c->'subweights','applicable_terms',c->'applicable_terms','units_per_term',c->'units_per_term','units_per_year',c->'units_per_year','passing_threshold',c->'passing_threshold',
 'ranges',(select jsonb_agg(jsonb_build_object('lower',r->'lower','upper',r->'upper','grade',r->'grade') order by (r->>'grade')::integer desc) from jsonb_array_elements(c->'ranges') r),
 'descriptors',(select jsonb_agg(jsonb_build_object('grade',r->'grade','label',r->'label') order by (r->>'grade')::integer desc) from jsonb_array_elements(c->'descriptors') r));
$$;
create function public.import_class_record(payload jsonb,confirmation_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare uid uuid:=auth.uid(); cid uuid; existing public.classes; old_batch public.import_batches; bid uuid; p jsonb; aid uuid; eid uuid; category_id uuid; term_id uuid; maximum numeric; v numeric;
 learner_map jsonb:='{}'; assessment_map jsonb:='{}'; strategy text:=payload->>'strategy'; inserted integer:=0; changed integer:=0; skipped integer:=0; prior public.scores; current_config jsonb; info jsonb:=payload->'info'; c jsonb:=payload->'config';
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if confirmation_token is null or payload is null or jsonb_typeof(payload)<>'object' or pg_column_size(payload)>12000000 then raise exception 'Invalid payload';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||confirmation_token::text,0));
 select * into old_batch from public.import_batches b where b.owner_id=uid and b.confirmation_token=import_class_record.confirmation_token;
 if found then if old_batch.payload_hash<>md5(payload::text) then raise exception 'Confirmation token reused with a different payload';end if;return jsonb_build_object('class_id',old_batch.class_id,'batch_id',old_batch.id,'summary',old_batch.summary,'idempotent',true);end if;
 if strategy not in ('new','keep','fill','replace') or strategy is null then raise exception 'Choose an explicit import strategy';end if;
 if not payload ?& array['info','config','learners','assessments','scores','provenance','filename','fingerprint','strategy','allow_missing_lrn'] or payload->>'filename' is null or payload->>'fingerprint' is null or jsonb_typeof(payload->'learners')<>'array' or jsonb_typeof(payload->'assessments')<>'array' or jsonb_typeof(payload->'scores')<>'array' or jsonb_typeof(payload->'provenance')<>'array' then raise exception 'Invalid payload arrays';end if;
 if jsonb_array_length(payload->'learners') not between 1 and 500 or jsonb_array_length(payload->'assessments')>200 or jsonb_array_length(payload->'scores')>100000 then raise exception 'Import limits exceeded';end if;
 if jsonb_typeof(info)<>'object' or coalesce(length(trim(info->>'section')),0)=0 or coalesce(length(trim(info->>'subject')),0)=0 or coalesce(length(trim(info->>'school_year')),0)=0 then raise exception 'Required class information missing';end if;
 perform public.validate_grading_config(c);
 if exists(select 1 from jsonb_array_elements(payload->'learners') l where l->>'lrn' is null) and coalesce((payload->>'allow_missing_lrn')::boolean,false)=false then raise exception 'Explicit missing LRN confirmation required';end if;
 if (select count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(payload->'learners'))<>jsonb_array_length(payload->'learners') and not coalesce((payload->>'allow_duplicate_names')::boolean,false) then raise exception 'Identical learner names require explicit distinct-learner confirmation';end if;
 if (select count(distinct value->>'key') from jsonb_array_elements(payload->'learners'))<>jsonb_array_length(payload->'learners') or (select count(distinct value->>'key') from jsonb_array_elements(payload->'assessments'))<>jsonb_array_length(payload->'assessments') then raise exception 'Duplicate source keys';end if;
 if (select count(*) from jsonb_array_elements(payload->'learners') l where l->>'lrn' is not null)<>(select count(distinct value->>'lrn') from jsonb_array_elements(payload->'learners') where value->>'lrn' is not null) then raise exception 'Duplicate LRNs';end if;
 if (select count(distinct (value->>'learner_key',value->>'assessment_key')) from jsonb_array_elements(payload->'scores'))<>jsonb_array_length(payload->'scores') then raise exception 'Duplicate score records';end if;
 if (select count(distinct value->>'enrollment_id') from jsonb_array_elements(payload->'learners') where value->>'enrollment_id' is not null)<>(select count(*) from jsonb_array_elements(payload->'learners') where value->>'enrollment_id' is not null) then raise exception 'Multiple learners mapped to one enrollment';end if;
 cid:=nullif(payload->>'class_id','')::uuid;
 if cid is not null then
  if strategy='new' then raise exception 'Choose reimport strategy';end if;
  select * into existing from public.classes where id=cid for update;
  if not found or existing.owner_id<>uid then raise exception 'Class access denied' using errcode='42501';end if;
  if existing.revision is distinct from (payload->>'expected_revision')::bigint then raise exception 'Class changed since preview; refresh and review again' using errcode='40001';end if;
  current_config:=public.config_json(cid);
  if public.canonical_config(current_config) is distinct from public.canonical_config(c) then raise exception 'Grading configuration conflict. Update configuration separately, then review reimport';end if;
  if (to_jsonb(existing)-array['id','owner_id','revision','archived','created_at']) is distinct from info then raise exception 'Class metadata conflict. Resolve class information before reimport';end if;
 else
  if strategy<>'new' then raise exception 'A target class is required';end if;
  insert into public.classes(owner_id,school,school_id,region,division,teacher,grade_level,section,school_year,subject,cluster,subject_category)
  values(uid,coalesce(info->>'school',''),coalesce(info->>'school_id',''),coalesce(info->>'region',''),coalesce(info->>'division',''),coalesce(info->>'teacher',''),coalesce(info->>'grade_level',''),info->>'section',info->>'school_year',info->>'subject',coalesce(info->>'cluster',''),coalesce(info->>'subject_category','')) returning id into cid;
  perform public.store_config(cid,c);
  insert into public.assessment_categories(class_id,code,label) values(cid,'ww','Written / Oral Works'),(cid,'pt','Product / Performance Tasks'),(cid,'ex','Examinations');
 end if;
 for p in select value from jsonb_array_elements(payload->'learners') loop
  if not p ?& array['key','name','lrn','sex'] or coalesce(length(trim(p->>'name')),0)=0 or coalesce(length(p->>'key'),0)=0 then raise exception 'Invalid learner';end if;
  eid:=nullif(p->>'enrollment_id','')::uuid;
  if eid is not null then
   if not exists(select 1 from public.class_enrollments e where e.id=eid and e.class_id=cid) then raise exception 'Enrollment access denied' using errcode='42501';end if;
   if exists(select 1 from public.class_enrollments e where e.id=eid and (e.lrn is distinct from p->>'lrn' or e.name is distinct from p->>'name' or e.sex is distinct from p->>'sex')) then raise exception 'Learner details conflict; edit learner separately';end if;
  else
   if p->>'lrn' is not null and exists(select 1 from public.class_enrollments e where e.class_id=cid and e.lrn=p->>'lrn') then raise exception 'Existing LRN must be explicitly mapped in preview';end if;
   insert into public.class_enrollments(class_id,name,lrn,sex,source_key) values(cid,trim(p->>'name'),p->>'lrn',coalesce(p->>'sex','unspecified'),p->>'key') returning id into eid;
  end if;
  learner_map:=learner_map||jsonb_build_object(p->>'key',eid);
 end loop;
 for p in select value from jsonb_array_elements(payload->'assessments') loop
  if not p ?& array['key','term','category','subcomponent','name','maximum'] or p->>'maximum' is null or p->>'key' is null or p->>'term' is null or p->>'name' is null or p->>'category' not in ('ww','pt','ex') or p->>'category' is null or (p->>'category'='ex')<>(p->>'subcomponent' is not null) then raise exception 'Invalid category/subcomponent';end if;
  select id into category_id from public.assessment_categories a where a.class_id=cid and a.code=p->>'category';
  select id into term_id from public.terms t where t.class_id=cid and t.number=(p->>'term')::integer;
  if term_id is null then raise exception 'Assessment belongs to an inactive term';end if;
  select a.id into aid from public.assessments a where a.class_id=cid and a.source_key=p->>'key';
  if aid is not null then
   if not exists(select 1 from public.assessments a where a.id=aid and a.maximum=(p->>'maximum')::numeric and a.term_id=term_id and a.category_id=category_id and a.subcomponent is not distinct from p->>'subcomponent' and a.name=p->>'name') then raise exception 'Assessment definition conflict; resolve before import';end if;
  else
   insert into public.assessments(class_id,term_id,category_id,source_key,name,maximum,subcomponent,ordinal) values(cid,term_id,category_id,p->>'key',p->>'name',(p->>'maximum')::numeric,p->>'subcomponent',(select count(*) from jsonb_object_keys(assessment_map))) returning id into aid;
  end if;
  assessment_map:=assessment_map||jsonb_build_object(p->>'key',aid);
 end loop;
 for p in select value from jsonb_array_elements(payload->'scores') loop
  if not p ?& array['learner_key','assessment_key','value'] then raise exception 'Missing score fields';end if;
  eid:=(learner_map->> (p->>'learner_key'))::uuid;aid:=(assessment_map->> (p->>'assessment_key'))::uuid;
  if eid is null or aid is null then raise exception 'Score references missing learner/assessment';end if;
  v:=(p->>'value')::numeric;select a.maximum into maximum from public.assessments a where a.id=aid;
  if v is not null and (v<0 or v>maximum or v='NaN'::numeric) then raise exception 'Score outside limits';end if;
  select * into prior from public.scores s where s.enrollment_id=eid and s.assessment_id=aid;
  if not found then insert into public.scores(class_id,enrollment_id,assessment_id,value) values(cid,eid,aid,v);inserted:=inserted+1;
  elsif strategy='replace' or strategy='fill' and prior.value is null then
   if prior.value is distinct from v then update public.scores set value=v,version=version+1,updated_at=now() where id=prior.id;changed:=changed+1;else skipped:=skipped+1;end if;
  else skipped:=skipped+1;end if;
 end loop;
 insert into public.import_batches(class_id,owner_id,confirmation_token,filename,fingerprint,payload_hash,strategy,summary) values(cid,uid,confirmation_token,payload->>'filename',payload->>'fingerprint',md5(payload::text),strategy,jsonb_build_object('inserted_scores',inserted,'changed_scores',changed,'kept_scores',skipped,'learners',jsonb_array_length(payload->'learners'))) returning id into bid;
 for p in select value from jsonb_array_elements(payload->'provenance') loop
  insert into public.import_provenance(class_id,batch_id,kind,record_key,sheet,cell,formula,cached) values(cid,bid,p->>'kind',p->>'key',p->'source'->>'sheet',p->'source'->>'cell',p->'source'->>'formula',p->'source'->'cached');
 end loop;
 update public.classes set revision=revision+1 where id=cid;
 return jsonb_build_object('class_id',cid,'batch_id',bid,'summary',jsonb_build_object('inserted_scores',inserted,'changed_scores',changed,'kept_scores',skipped),'idempotent',false);
end;
$$;
create function public.save_score(p_class uuid,p_enrollment uuid,p_assessment uuid,p_value numeric,p_expected_version bigint) returns public.scores language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare c public.classes; a public.assessments; s public.scores;
begin
 select * into c from public.classes where id=p_class for update;
 if not found or c.owner_id is distinct from auth.uid() or auth.uid() is null then raise exception 'Class access denied' using errcode='42501';end if;
 select * into a from public.assessments where id=p_assessment and class_id=p_class;
 if not found or not exists(select 1 from public.class_enrollments where id=p_enrollment and class_id=p_class) then raise exception 'Invalid score references';end if;
 if p_value is not null and (p_value<0 or p_value>a.maximum or p_value='NaN'::numeric) then raise exception 'Score outside limits';end if;
 select * into s from public.scores where assessment_id=p_assessment and enrollment_id=p_enrollment;
 if found then
  if s.version is distinct from p_expected_version then raise exception 'Score changed in another session; refresh before editing' using errcode='40001';end if;
  update public.scores set value=p_value,version=version+1,updated_at=now() where id=s.id returning * into s;
 else
  if p_expected_version is not null then raise exception 'Stale score version' using errcode='40001';end if;
  insert into public.scores(class_id,enrollment_id,assessment_id,value) values(p_class,p_enrollment,p_assessment,p_value) returning * into s;
 end if;
 update public.classes set revision=revision+1 where id=p_class;return s;
end;
$$;
create function public.manage_record(p_class uuid,p_expected_revision bigint,p_action text,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare c public.classes; rid uuid; a public.assessments;
begin
 select * into c from public.classes where id=p_class for update;
 if not found or c.owner_id is distinct from auth.uid() or auth.uid() is null then raise exception 'Class access denied' using errcode='42501';end if;
 if c.revision is distinct from p_expected_revision then raise exception 'Class changed; refresh before saving' using errcode='40001';end if;
 rid:=nullif(p_data->>'id','')::uuid;
 if p_action='learner' then
  if rid is null then insert into public.class_enrollments(class_id,name,lrn,sex) values(p_class,trim(p_data->>'name'),nullif(p_data->>'lrn',''),coalesce(p_data->>'sex','unspecified')) returning id into rid;
  else update public.class_enrollments set name=trim(p_data->>'name'),lrn=nullif(p_data->>'lrn',''),sex=coalesce(p_data->>'sex','unspecified') where id=rid and class_id=p_class;if not found then raise exception 'Learner access denied';end if;end if;
 elsif p_action='assessment' then
  if not exists(select 1 from public.terms where id=(p_data->>'term_id')::uuid and class_id=p_class) or not exists(select 1 from public.assessment_categories where id=(p_data->>'category_id')::uuid and class_id=p_class and (code='ex')=(p_data->>'subcomponent' is not null)) then raise exception 'Invalid assessment references';end if;
  if rid is null then insert into public.assessments(class_id,term_id,category_id,source_key,name,maximum,subcomponent,ordinal) values(p_class,(p_data->>'term_id')::uuid,(p_data->>'category_id')::uuid,'manual-'||gen_random_uuid(),p_data->>'name',(p_data->>'maximum')::numeric,p_data->>'subcomponent',coalesce((p_data->>'ordinal')::integer,0)) returning id into rid;
  else
   select * into a from public.assessments where id=rid and class_id=p_class;
   if not found then raise exception 'Assessment access denied';end if;
   if a.category_id<>(p_data->>'category_id')::uuid or a.term_id<>(p_data->>'term_id')::uuid or a.subcomponent is distinct from p_data->>'subcomponent' then raise exception 'Existing assessment grouping cannot change';end if;
   if exists(select 1 from public.scores where assessment_id=rid and value>(p_data->>'maximum')::numeric) then raise exception 'Maximum below an existing score';end if;
   update public.assessments set name=p_data->>'name',maximum=(p_data->>'maximum')::numeric where id=rid;
  end if;
 elsif p_action='configuration' then perform public.store_config(p_class,p_data);rid:=p_class;
 elsif p_action='archive' then update public.classes set archived=(p_data->>'archived')::boolean where id=p_class;rid:=p_class;
 elsif p_action='class' then
  update public.classes set school=coalesce(p_data->>'school',c.school),school_id=coalesce(p_data->>'school_id',c.school_id),region=coalesce(p_data->>'region',c.region),division=coalesce(p_data->>'division',c.division),teacher=coalesce(p_data->>'teacher',c.teacher),grade_level=coalesce(p_data->>'grade_level',c.grade_level),section=coalesce(p_data->>'section',c.section),school_year=coalesce(p_data->>'school_year',c.school_year),subject=coalesce(p_data->>'subject',c.subject),cluster=coalesce(p_data->>'cluster',c.cluster),subject_category=coalesce(p_data->>'subject_category',c.subject_category) where id=p_class;rid:=p_class;
 else raise exception 'Unsupported action';end if;
 update public.classes set revision=revision+1 where id=p_class;return rid;
end;
$$;
create function public.create_class(p_info jsonb,p_config jsonb) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare cid uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if coalesce(length(trim(p_info->>'section')),0)=0 or coalesce(length(trim(p_info->>'subject')),0)=0 or coalesce(length(trim(p_info->>'school_year')),0)=0 then raise exception 'Section, subject, and school year required';end if;
 perform public.validate_grading_config(p_config);
 insert into public.classes(owner_id,school,school_id,region,division,teacher,grade_level,section,school_year,subject,cluster,subject_category)
 values(auth.uid(),coalesce(p_info->>'school',''),coalesce(p_info->>'school_id',''),coalesce(p_info->>'region',''),coalesce(p_info->>'division',''),coalesce(p_info->>'teacher',''),coalesce(p_info->>'grade_level',''),p_info->>'section',p_info->>'school_year',p_info->>'subject',coalesce(p_info->>'cluster',''),coalesce(p_info->>'subject_category','')) returning id into cid;
 perform public.store_config(cid,p_config);
 insert into public.assessment_categories(class_id,code,label) values(cid,'ww','Written / Oral Works'),(cid,'pt','Product / Performance Tasks'),(cid,'ex','Examinations');return cid;
end;
$$;
revoke all on function public.store_config(uuid,jsonb),public.canonical_config(jsonb) from public,anon,authenticated;
revoke all on function public.import_class_record(jsonb,uuid),public.save_score(uuid,uuid,uuid,numeric,bigint),public.manage_record(uuid,bigint,text,jsonb),public.create_class(jsonb,jsonb) from public,anon;
grant execute on function public.import_class_record(jsonb,uuid),public.save_score(uuid,uuid,uuid,numeric,bigint),public.manage_record(uuid,bigint,text,jsonb),public.create_class(jsonb,jsonb) to authenticated;


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('workbooks','workbooks',false,15728640,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/octet-stream']) on conflict(id) do nothing;
create function public.owns_workbook_path(p_name text) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare parts text[]:=string_to_array(p_name,'/');
begin
 if array_length(parts,1)<>4 or parts[1]<>auth.uid()::text then return false;end if;
 return public.owns_class(parts[2]::uuid) and exists(select 1 from public.import_batches b where b.id=parts[3]::uuid and b.class_id=parts[2]::uuid and b.owner_id=auth.uid());
exception when invalid_text_representation then return false;
end;
$$;
create policy workbook_read on storage.objects for select to authenticated using(bucket_id='workbooks' and public.owns_workbook_path(name));
create policy workbook_insert on storage.objects for insert to authenticated with check(bucket_id='workbooks' and public.owns_workbook_path(name));
create policy workbook_delete on storage.objects for delete to authenticated using(bucket_id='workbooks' and public.owns_workbook_path(name));
revoke all on function public.owns_workbook_path(text) from public,anon;
grant execute on function public.owns_workbook_path(text) to authenticated;


-- Zero-weight components and exam subcomponents do not require scores.
create or replace function public.grade_rules(c jsonb, inputs jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare category text; sub text; components jsonb:='{}'; exam jsonb:='{"ST1":null,"ST2":null,"TE":null}'; a jsonb;
 total numeric; maximum numeric; ps numeric; ws numeric; part numeric; exsum numeric:=0; exentered integer:=0; entered integer; active integer; missing integer;
 inc boolean:=false; ig numeric; tg integer; provisional boolean; weight numeric; subweight numeric;
begin
 foreach category in array array['ww','pt','ex'] loop
  select sum((i->>'maximum')::numeric),sum((i->>'value')::numeric),count(*) filter(where i->>'value' is not null),count(*),count(*) filter(where i->>'value' is null)
  into maximum,total,entered,active,missing from jsonb_array_elements(inputs) i where i->>'category'=category and (i->>'maximum')::numeric>0;
  maximum:=coalesce(maximum,0);weight:=(c->'weights'->>category)::numeric;ps:=null;ws:=null;
  if entered=0 then total:=null;end if;
  if category<>'ex' and weight>0 and (active=0 or missing>0) then inc:=true;end if;
  if category='ex' then
   foreach sub in array array['ST1','ST2','TE'] loop
    subweight:=(c->'subweights'->>sub)::numeric;
    a:=null;select i into a from jsonb_array_elements(inputs) i where i->>'category'='ex' and i->>'subcomponent'=sub and (i->>'maximum')::numeric>0 limit 1;
    part:=null;
    if weight>0 and subweight>0 and (a is null or a->>'value' is null) then inc:=true;end if;
    if a is not null and a->>'value' is not null then part:=round((a->>'value')::numeric/(a->>'maximum')::numeric*subweight,2);exsum:=exsum+part;exentered:=exentered+1;end if;
    exam:=exam||jsonb_build_object(sub,part);
   end loop;
   if weight>0 and exentered>0 and ((c->'subweights'->>'ST1')::numeric+(c->'subweights'->>'ST2')::numeric+(c->'subweights'->>'TE')::numeric)>0 then
    ps:=exsum/((c->'subweights'->>'ST1')::numeric+(c->'subweights'->>'ST2')::numeric+(c->'subweights'->>'TE')::numeric)*100;
   end if;
  elsif total is not null and maximum>0 then ps:=round(total/maximum*100,2);end if;
  if ps is not null then ws:=round(ps*weight/100,2);end if;
  if weight=0 then ws:=0;end if;
  components:=components||jsonb_build_object(category,jsonb_build_object('total',total,'maximum',maximum,'ps',ps,'ws',ws));
 end loop;
 if components->'ww'->>'ws' is not null and components->'pt'->>'ws' is not null and ((c->'weights'->>'ex')::numeric=0 or components->'ex'->>'ws' is not null) then
  ig:=(components->'ww'->>'ws')::numeric+(components->'pt'->>'ws')::numeric+coalesce((components->'ex'->>'ws')::numeric,0);
 end if;
 if ig is not null and (c->>'resolved')::boolean then select (r->>'grade')::integer into tg from jsonb_array_elements(c->'ranges') r where (r->>'upper')::numeric>=ig order by (r->>'upper')::numeric limit 1;end if;
 provisional:=not (c->>'resolved')::boolean or (ig is not null and tg is null);
 return jsonb_build_object('components',components,'exam',exam,'initial',ig,'grade',tg,'incomplete',inc or ig is null,'provisional',provisional);
end;
$$;


-- Bounded learner pages; invoker security keeps every read under existing RLS.
create function public.record_page(p_class uuid, p_page integer default 0,
 p_size integer default 10, p_search text default '', p_status text default 'all',
 p_sort text default 'learner', p_desc boolean default false, p_term integer default 1,
 p_final boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare cfg jsonb; info jsonb; ids uuid[]; total integer; page integer; size integer;
begin
 if p_page < 0 or p_size not between 1 and 100 or p_term not between 1 and 3
 or p_status not in ('all','incomplete','below','failed')
 or p_sort not in ('learner','initial','grade','ww.total','ww.ps','ww.ws','pt.total','pt.ps','pt.ws','ex.total','ex.ps','ex.ws','subST1','subST2','subTE') then
  raise exception 'Invalid pagination options';
 end if;
 select to_jsonb(c) into info from public.classes c where c.id=p_class;
 if info is null then raise exception 'Class not found or access denied'; end if;
 cfg:=public.config_json(p_class); size:=p_size;
 with candidates as materialized (
  select e.id,e.name,
   case when p_final then f.result else t.result end g
  from public.class_enrollments e
  left join public.term_grades t on not p_final and t.enrollment_id=e.id and t.number=p_term
  left join public.final_grades f on p_final and f.enrollment_id=e.id
  where e.class_id=p_class and (position(lower(trim(p_search)) in lower(e.name))>0
    or position(lower(trim(p_search)) in lower(coalesce(e.lrn,'')))>0)
 ), filtered as materialized (
  select *, case
   when p_sort='grade' then (g->>case when p_final then 'final' else 'grade' end)::numeric
   when p_sort='initial' then (g->>'initial')::numeric
   when p_sort like 'sub%' then (g->'exam'->>substring(p_sort from 4))::numeric
   when position('.' in p_sort)>0 then (g->'components'->split_part(p_sort,'.',1)->>split_part(p_sort,'.',2))::numeric
   end sort_value
  from candidates where p_status='all'
   or (p_status='incomplete' and ((g->>'incomplete')::boolean or (g->>'provisional')::boolean))
   or (p_status='failed' and g->>'remark'='FAILED')
   or (p_status='below' and not (g->>'incomplete')::boolean and not (g->>'provisional')::boolean and (g->>'grade')::numeric<(cfg->>'passing_threshold')::numeric)
 ), ordered as (
  select id,row_number() over(order by
   case when p_sort='learner' and not p_desc then lower(name) end asc,
   case when p_sort='learner' and p_desc then lower(name) end desc,
   case when p_sort<>'learner' and not p_desc then sort_value end asc nulls last,
   case when p_sort<>'learner' and p_desc then sort_value end desc nulls last,
   lower(name),id) rn from filtered
 ), counts as (select count(*)::integer n from filtered)
 select n,least(p_page,greatest(0,(n-1)/size)),
  coalesce((select array_agg(id order by rn) from ordered
   where rn>least(p_page,greatest(0,(n-1)/size))*size
   and rn<= (least(p_page,greatest(0,(n-1)/size))+1)*size),'{}'::uuid[])
 into total,page,ids from counts;
 return jsonb_build_object('info',info,'config',cfg,'total',total,'page',page,'pageSize',size,
  'learners',coalesce((select jsonb_agg(to_jsonb(e) order by array_position(ids,e.id)) from public.class_enrollments e where e.id=any(ids)),'[]'),
  'assessments',coalesce((select jsonb_agg(a order by a.ordinal,a.id) from public.assessments a where a.class_id=p_class),'[]'),
  'terms',coalesce((select jsonb_agg(t order by t.number) from public.terms t where t.class_id=p_class),'[]'),
  'categories',coalesce((select jsonb_agg(c) from public.assessment_categories c where c.class_id=p_class),'[]'),
  'scores',coalesce((select jsonb_agg(s) from public.scores s join public.assessments a on a.id=s.assessment_id join public.terms t on t.id=a.term_id where s.enrollment_id=any(ids) and not p_final and t.number=p_term),'[]'),
  'termGrades',coalesce((select jsonb_agg(t) from public.term_grades t where t.enrollment_id=any(ids) and (p_final or t.number=p_term)),'[]'),
  'finalGrades',coalesce((select jsonb_agg(f) from public.final_grades f where p_final and f.enrollment_id=any(ids)),'[]'));
end;
$$;
revoke all on function public.record_page(uuid,integer,integer,text,text,text,boolean,integer,boolean) from public,anon;
grant execute on function public.record_page(uuid,integer,integer,text,text,text,boolean,integer,boolean) to authenticated;


-- Deletes are scoped to the teacher's class and serialized with other edits.
create function public.delete_record(p_class uuid,p_expected_revision bigint,p_kind text,p_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.classes;
begin
 select * into c from public.classes where id=p_class for update;
 if not found or auth.uid() is null or c.owner_id is distinct from auth.uid() then
  raise exception 'Class access denied' using errcode='42501';
 end if;
 if c.revision is distinct from p_expected_revision then
  raise exception 'Class changed; refresh before deleting' using errcode='40001';
 end if;
 if p_kind='learner' then
  delete from public.class_enrollments where id=p_id and class_id=p_class;
 elsif p_kind='assessment' then
  delete from public.assessments where id=p_id and class_id=p_class;
 else raise exception 'Unsupported record type';
 end if;
 if not found then raise exception 'Record not found in this class'; end if;
 -- Foreign keys remove associated scores; grade views recalculate on next read.
 update public.classes set revision=revision+1 where id=p_class;
 return p_id;
end;
$$;
revoke all on function public.delete_record(uuid,bigint,text,uuid) from public,anon;
grant execute on function public.delete_record(uuid,bigint,text,uuid) to authenticated;


-- Deleted records remain private and recoverable with their original scores.
create table public.deleted_records (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
 kind text not null check(kind in ('learner','assessment')), name text not null,
 record jsonb not null, scores jsonb not null, deleted_at timestamptz not null default now(), restored_at timestamptz
);
create index deleted_records_class on public.deleted_records(class_id,deleted_at desc);
alter table public.deleted_records enable row level security;
create policy teacher_read_deleted on public.deleted_records for select to authenticated using(exists(select 1 from public.classes c where c.id=class_id and c.owner_id=auth.uid()));
grant select on public.deleted_records to authenticated;
create or replace function public.delete_record(p_class uuid,p_expected_revision bigint,p_kind text,p_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.classes; r jsonb; ss jsonb;
begin
 select * into c from public.classes where id=p_class for update;
 if not found or auth.uid() is null or c.owner_id is distinct from auth.uid() then raise exception 'Class access denied' using errcode='42501';end if;
 if c.revision is distinct from p_expected_revision then raise exception 'Class changed; refresh before deleting' using errcode='40001';end if;
 if p_kind='learner' then
  select to_jsonb(e) into r from public.class_enrollments e where id=p_id and class_id=p_class;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]') into ss from public.scores s where enrollment_id=p_id and class_id=p_class;
 elsif p_kind='assessment' then
  select to_jsonb(a) into r from public.assessments a where id=p_id and class_id=p_class;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]') into ss from public.scores s where assessment_id=p_id and class_id=p_class;
 else raise exception 'Unsupported record type';end if;
 if r is null then raise exception 'Record not found in this class';end if;
 insert into public.deleted_records(class_id,kind,name,record,scores) values(p_class,p_kind,r->>'name',r,ss);
 if p_kind='learner' then delete from public.class_enrollments where id=p_id and class_id=p_class;
 else delete from public.assessments where id=p_id and class_id=p_class;end if;
 update public.classes set revision=revision+1 where id=p_class;
 return p_id;
end;$$;
create function public.restore_record(p_class uuid,p_expected_revision bigint,p_deleted uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.classes; d public.deleted_records; s public.scores;
begin
 select * into c from public.classes where id=p_class for update;
 if not found or auth.uid() is null or c.owner_id is distinct from auth.uid() then raise exception 'Class access denied' using errcode='42501';end if;
 if c.revision is distinct from p_expected_revision then raise exception 'Class changed; refresh before restoring' using errcode='40001';end if;
 select * into d from public.deleted_records where id=p_deleted and class_id=p_class for update;
 if not found or d.restored_at is not null then raise exception 'Deleted record unavailable or already restored';end if;
 if d.kind='learner' then insert into public.class_enrollments select * from jsonb_populate_record(null::public.class_enrollments,d.record);
 else insert into public.assessments select * from jsonb_populate_record(null::public.assessments,d.record);end if;
 for s in select * from jsonb_populate_recordset(null::public.scores,d.scores) loop
  if not exists(select 1 from public.class_enrollments where id=s.enrollment_id and class_id=p_class)
   or not exists(select 1 from public.assessments where id=s.assessment_id and class_id=p_class) then
   raise exception 'Restore the other deleted learner or assessment first, then try again';end if;
  if s.value > (select maximum from public.assessments where id=s.assessment_id and class_id=p_class) then
   raise exception 'A saved score exceeds the current assessment maximum. Adjust the maximum before restoring';end if;
  s.version:=s.version+1; s.updated_at:=now();
  insert into public.scores select s.*;
 end loop;
 update public.deleted_records set restored_at=now() where id=d.id;
 update public.classes set revision=revision+1 where id=p_class;
 return (d.record->>'id')::uuid;
exception when unique_violation then raise exception 'A matching record already exists. Resolve the duplicate before restoring';
 when foreign_key_violation then raise exception 'The original term or category is missing. Restore the grading setup first';
end;$$;
revoke all on function public.restore_record(uuid,bigint,uuid) from public,anon;
grant execute on function public.restore_record(uuid,bigint,uuid) to authenticated;
-- Serialize new imports of the same file. Existing confirmation tokens remain idempotent.
alter function public.import_class_record(jsonb,uuid) rename to import_class_record_internal;
create or replace function public.import_class_record_internal(payload jsonb,confirmation_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare uid uuid:=auth.uid(); cid uuid; existing public.classes; old_batch public.import_batches; bid uuid; p jsonb; aid uuid; eid uuid; category_id uuid; term_id uuid; maximum numeric; v numeric;
 learner_map jsonb:='{}'; assessment_map jsonb:='{}'; strategy text:=payload->>'strategy'; inserted integer:=0; changed integer:=0; skipped integer:=0; prior public.scores; current_config jsonb; info jsonb:=payload->'info'; c jsonb:=payload->'config';
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if confirmation_token is null or payload is null or jsonb_typeof(payload)<>'object' or pg_column_size(payload)>12000000 then raise exception 'Invalid payload';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||confirmation_token::text,0));
 select * into old_batch from public.import_batches b where b.owner_id=uid and b.confirmation_token=import_class_record_internal.confirmation_token;
 if found then if old_batch.payload_hash<>md5(payload::text) then raise exception 'Confirmation token reused with a different payload';end if;return jsonb_build_object('class_id',old_batch.class_id,'batch_id',old_batch.id,'summary',old_batch.summary,'idempotent',true);end if;
 if strategy not in ('new','keep','fill','replace') or strategy is null then raise exception 'Choose an explicit import strategy';end if;
 if not payload ?& array['info','config','learners','assessments','scores','provenance','filename','fingerprint','strategy','allow_missing_lrn'] or payload->>'filename' is null or payload->>'fingerprint' is null or jsonb_typeof(payload->'learners')<>'array' or jsonb_typeof(payload->'assessments')<>'array' or jsonb_typeof(payload->'scores')<>'array' or jsonb_typeof(payload->'provenance')<>'array' then raise exception 'Invalid payload arrays';end if;
 if jsonb_array_length(payload->'learners') not between 1 and 500 or jsonb_array_length(payload->'assessments')>200 or jsonb_array_length(payload->'scores')>100000 then raise exception 'Import limits exceeded';end if;
 if jsonb_typeof(info)<>'object' or coalesce(length(trim(info->>'section')),0)=0 or coalesce(length(trim(info->>'subject')),0)=0 or coalesce(length(trim(info->>'school_year')),0)=0 then raise exception 'Required class information missing';end if;
 perform public.validate_grading_config(c);
 if exists(select 1 from jsonb_array_elements(payload->'learners') l where l->>'lrn' is null) and coalesce((payload->>'allow_missing_lrn')::boolean,false)=false then raise exception 'Explicit missing LRN confirmation required';end if;
 if (select count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(payload->'learners'))<>jsonb_array_length(payload->'learners') and not coalesce((payload->>'allow_duplicate_names')::boolean,false) then raise exception 'Identical learner names require explicit distinct-learner confirmation';end if;
 if (select count(distinct value->>'key') from jsonb_array_elements(payload->'learners'))<>jsonb_array_length(payload->'learners') or (select count(distinct value->>'key') from jsonb_array_elements(payload->'assessments'))<>jsonb_array_length(payload->'assessments') then raise exception 'Duplicate source keys';end if;
 if (select count(*) from jsonb_array_elements(payload->'learners') l where l->>'lrn' is not null)<>(select count(distinct value->>'lrn') from jsonb_array_elements(payload->'learners') where value->>'lrn' is not null) then raise exception 'Duplicate LRNs';end if;
 if (select count(distinct (value->>'learner_key',value->>'assessment_key')) from jsonb_array_elements(payload->'scores'))<>jsonb_array_length(payload->'scores') then raise exception 'Duplicate score records';end if;
 if (select count(distinct value->>'enrollment_id') from jsonb_array_elements(payload->'learners') where value->>'enrollment_id' is not null)<>(select count(*) from jsonb_array_elements(payload->'learners') where value->>'enrollment_id' is not null) then raise exception 'Multiple learners mapped to one enrollment';end if;
 cid:=nullif(payload->>'class_id','')::uuid;
 if cid is not null then
  if strategy='new' then raise exception 'Choose reimport strategy';end if;
  select * into existing from public.classes where id=cid for update;
  if not found or existing.owner_id<>uid then raise exception 'Class access denied' using errcode='42501';end if;
  if existing.revision is distinct from (payload->>'expected_revision')::bigint then raise exception 'Class changed since preview; refresh and review again' using errcode='40001';end if;
  current_config:=public.config_json(cid);
  if public.canonical_config(current_config) is distinct from public.canonical_config(c) then raise exception 'Grading configuration conflict. Update configuration separately, then review reimport';end if;
  if (to_jsonb(existing)-array['id','owner_id','revision','archived','created_at']) is distinct from info then raise exception 'Class metadata conflict. Resolve class information before reimport';end if;
 else
  if strategy<>'new' then raise exception 'A target class is required';end if;
  insert into public.classes(owner_id,school,school_id,region,division,teacher,grade_level,section,school_year,subject,cluster,subject_category)
  values(uid,coalesce(info->>'school',''),coalesce(info->>'school_id',''),coalesce(info->>'region',''),coalesce(info->>'division',''),coalesce(info->>'teacher',''),coalesce(info->>'grade_level',''),info->>'section',info->>'school_year',info->>'subject',coalesce(info->>'cluster',''),coalesce(info->>'subject_category','')) returning id into cid;
  perform public.store_config(cid,c);
  insert into public.assessment_categories(class_id,code,label) values(cid,'ww','Written / Oral Works'),(cid,'pt','Product / Performance Tasks'),(cid,'ex','Examinations');
 end if;
 for p in select value from jsonb_array_elements(payload->'learners') loop
  if not p ?& array['key','name','lrn','sex'] or coalesce(length(trim(p->>'name')),0)=0 or coalesce(length(p->>'key'),0)=0 then raise exception 'Invalid learner';end if;
  eid:=nullif(p->>'enrollment_id','')::uuid;
  if eid is not null then
   if not exists(select 1 from public.class_enrollments e where e.id=eid and e.class_id=cid) then raise exception 'Enrollment access denied' using errcode='42501';end if;
   if exists(select 1 from public.class_enrollments e where e.id=eid and (e.lrn is distinct from p->>'lrn' or e.name is distinct from p->>'name' or e.sex is distinct from p->>'sex')) then raise exception 'Learner details conflict; edit learner separately';end if;
  else
   if p->>'lrn' is not null and exists(select 1 from public.class_enrollments e where e.class_id=cid and e.lrn=p->>'lrn') then raise exception 'Existing LRN must be explicitly mapped in preview';end if;
   insert into public.class_enrollments(class_id,name,lrn,sex,source_key) values(cid,trim(p->>'name'),p->>'lrn',coalesce(p->>'sex','unspecified'),p->>'key') returning id into eid;
  end if;
  learner_map:=learner_map||jsonb_build_object(p->>'key',eid);
 end loop;
 for p in select value from jsonb_array_elements(payload->'assessments') loop
  if not p ?& array['key','term','category','subcomponent','name','maximum'] or p->>'maximum' is null or p->>'key' is null or p->>'term' is null or p->>'name' is null or p->>'category' not in ('ww','pt','ex') or p->>'category' is null or (p->>'category'='ex')<>(p->>'subcomponent' is not null) then raise exception 'Invalid category/subcomponent';end if;
  select id into category_id from public.assessment_categories a where a.class_id=cid and a.code=p->>'category';
  select id into term_id from public.terms t where t.class_id=cid and t.number=(p->>'term')::integer;
  if term_id is null then raise exception 'Assessment belongs to an inactive term';end if;
  select a.id into aid from public.assessments a where a.class_id=cid and a.source_key=p->>'key';
  if aid is not null then
   if not exists(select 1 from public.assessments a where a.id=aid and a.maximum=(p->>'maximum')::numeric and a.term_id=term_id and a.category_id=category_id and a.subcomponent is not distinct from p->>'subcomponent' and a.name=p->>'name') then raise exception 'Assessment definition conflict; resolve before import';end if;
  else
   insert into public.assessments(class_id,term_id,category_id,source_key,name,maximum,subcomponent,ordinal) values(cid,term_id,category_id,p->>'key',p->>'name',(p->>'maximum')::numeric,p->>'subcomponent',(select count(*) from jsonb_object_keys(assessment_map))) returning id into aid;
  end if;
  assessment_map:=assessment_map||jsonb_build_object(p->>'key',aid);
 end loop;
 for p in select value from jsonb_array_elements(payload->'scores') loop
  if not p ?& array['learner_key','assessment_key','value'] then raise exception 'Missing score fields';end if;
  eid:=(learner_map->> (p->>'learner_key'))::uuid;aid:=(assessment_map->> (p->>'assessment_key'))::uuid;
  if eid is null or aid is null then raise exception 'Score references missing learner/assessment';end if;
  v:=(p->>'value')::numeric;select a.maximum into maximum from public.assessments a where a.id=aid;
  if v is not null and (v<0 or v>maximum or v='NaN'::numeric) then raise exception 'Score outside limits';end if;
  select * into prior from public.scores s where s.enrollment_id=eid and s.assessment_id=aid;
  if not found then insert into public.scores(class_id,enrollment_id,assessment_id,value) values(cid,eid,aid,v);inserted:=inserted+1;
  elsif strategy='replace' or strategy='fill' and prior.value is null then
   if prior.value is distinct from v then update public.scores set value=v,version=version+1,updated_at=now() where id=prior.id;changed:=changed+1;else skipped:=skipped+1;end if;
  else skipped:=skipped+1;end if;
 end loop;
 insert into public.import_batches(class_id,owner_id,confirmation_token,filename,fingerprint,payload_hash,strategy,summary) values(cid,uid,confirmation_token,payload->>'filename',payload->>'fingerprint',md5(payload::text),strategy,jsonb_build_object('inserted_scores',inserted,'changed_scores',changed,'kept_scores',skipped,'learners',jsonb_array_length(payload->'learners'))) returning id into bid;
 for p in select value from jsonb_array_elements(payload->'provenance') loop
  insert into public.import_provenance(class_id,batch_id,kind,record_key,sheet,cell,formula,cached) values(cid,bid,p->>'kind',p->>'key',p->'source'->>'sheet',p->'source'->>'cell',p->'source'->>'formula',p->'source'->'cached');
 end loop;
 update public.classes set revision=revision+1 where id=cid;
 return jsonb_build_object('class_id',cid,'batch_id',bid,'summary',jsonb_build_object('inserted_scores',inserted,'changed_scores',changed,'kept_scores',skipped),'idempotent',false);
end;
$$;
revoke all on function public.import_class_record_internal(jsonb,uuid) from public,anon,authenticated;
create function public.import_class_record(payload jsonb,confirmation_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if payload->>'strategy'='new' then
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||coalesce(payload->>'fingerprint',''),1));
  if not exists(select 1 from public.import_batches b where b.owner_id=auth.uid() and b.confirmation_token=import_class_record.confirmation_token)
   and not coalesce((payload->>'allow_duplicate_file')::boolean,false)
   and exists(select 1 from public.import_batches b where b.owner_id=auth.uid() and b.fingerprint=payload->>'fingerprint') then
   raise exception 'This workbook was already imported. Update the existing class or explicitly choose to create another class';end if;
 end if;
 return public.import_class_record_internal(payload,confirmation_token);
end;$$;
revoke all on function public.import_class_record(jsonb,uuid) from public,anon;
grant execute on function public.import_class_record(jsonb,uuid) to authenticated;


-- One owner-scoped aggregate request; no score or full roster download.
create function public.dashboard_summary(p_class uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with c as materialized(select * from public.classes where owner_id=auth.uid() and not archived and (p_class is null or id=p_class)),
e as materialized(select e.* from public.class_enrollments e join c on c.id=e.class_id),
t as materialized(select g.* from public.term_grades g join c on c.id=g.class_id),
f as materialized(select g.* from public.final_grades g join c on c.id=g.class_id),
valid as(select (result->>'grade')::numeric grade from t where not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean and result->>'grade' is not null),
attention as materialized(select e.id,e.name,c.section,c.id class_id,
 exists(select 1 from t where t.enrollment_id=e.id and ((result->>'incomplete')::boolean or (result->>'provisional')::boolean))
 or exists(select 1 from f where f.enrollment_id=e.id and ((result->>'incomplete')::boolean or (result->>'provisional')::boolean)) incomplete,
 exists(select 1 from t join public.grading_configurations cfg on cfg.class_id=t.class_id where t.enrollment_id=e.id and not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean and (result->>'grade')::numeric < cfg.passing_threshold) below
 from e join c on c.id=e.class_id),
a as(select a.id,c.section||' · '||a.name name,avg(s.value/a.maximum*100) average,count(s.value) entered from public.assessments a join c on c.id=a.class_id left join public.scores s on s.assessment_id=a.id group by a.id,c.section,a.name)
select jsonb_build_object(
 'classes',coalesce((select jsonb_agg(jsonb_build_object('info',to_jsonb(c),'learnerCount',(select count(*) from e where class_id=c.id)) order by c.section,c.id) from c),'[]'),
 'students',(select count(*) from e),'term',(select avg(grade) from valid),
 'final',(select avg((result->>'final')::numeric) from f where not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean),
 'bins',(select jsonb_agg(jsonb_build_object('label',label,'count',(select count(*) from valid where grade>=lo and grade<hi)) order by lo) from (values('60–64',60,65),('65–74',65,75),('75–79',75,80),('80–89',80,90),('90–100',90,101)) b(label,lo,hi)),
 'incompleteCount',(select count(*) from attention where incomplete),'belowCount',(select count(*) from attention where below),
 'incomplete',coalesce((select jsonb_agg(jsonb_build_object('name',name,'section',section,'id',class_id)) from (select * from attention where incomplete order by section,name,id limit 5) x),'[]'),
 'below',coalesce((select jsonb_agg(jsonb_build_object('name',name,'section',section,'id',class_id)) from (select * from attention where below order by section,name,id limit 50) x),'[]'),
 'assessment',coalesce((select jsonb_agg(jsonb_build_object('name',name,'average',average,'entered',entered) order by name,id) from a),'[]'));
$$;
revoke all on function public.dashboard_summary(uuid) from public,anon;
grant execute on function public.dashboard_summary(uuid) to authenticated;


create index import_batches_owner_fingerprint on public.import_batches(owner_id,fingerprint);
-- One owner-scoped aggregate request; no score or full roster download.
create or replace function public.dashboard_summary(p_class uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with c as materialized(select * from public.classes where owner_id=auth.uid() and not archived and (p_class is null or id=p_class)),
e as materialized(select e.* from public.class_enrollments e join c on c.id=e.class_id),
t as materialized(select g.* from public.term_grades g join c on c.id=g.class_id),
f as materialized(select g.* from public.final_grades g join c on c.id=g.class_id),
valid as(select (result->>'grade')::numeric grade from t where not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean and result->>'grade' is not null),
attention as materialized(select e.id,e.name,c.section,c.id class_id,
 exists(select 1 from t where t.enrollment_id=e.id and ((result->>'incomplete')::boolean or (result->>'provisional')::boolean))
 or exists(select 1 from f where f.enrollment_id=e.id and ((result->>'incomplete')::boolean or (result->>'provisional')::boolean)) incomplete,
 exists(select 1 from t join public.grading_configurations cfg on cfg.class_id=t.class_id where t.enrollment_id=e.id and not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean and (result->>'grade')::numeric < cfg.passing_threshold) below
 from e join c on c.id=e.class_id),
a as(select a.id,c.section||' · '||a.name name,avg(s.value/a.maximum*100) average,count(s.value) entered from public.assessments a join c on c.id=a.class_id left join public.scores s on s.assessment_id=a.id group by a.id,c.section,a.name)
select jsonb_build_object(
 'classes',coalesce((select jsonb_agg(jsonb_build_object('info',to_jsonb(c),'learnerCount',(select count(*) from e where class_id=c.id)) order by c.section,c.id) from c),'[]'),
 'students',(select count(*) from e),'term',(select avg(grade) from valid),
 'final',(select avg((result->>'final')::numeric) from f where not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean),
 'bins',(select jsonb_agg(jsonb_build_object('label',label,'count',(select count(*) from valid where grade>=lo and grade<hi)) order by lo) from (values('60–64',60,65),('65–74',65,75),('75–79',75,80),('80–89',80,90),('90–100',90,101)) b(label,lo,hi)),
 'incompleteCount',(select count(*) from attention where incomplete),'belowCount',(select count(*) from attention where below),
 'incomplete',coalesce((select jsonb_agg(jsonb_build_object('name',name,'section',section,'id',class_id)) from (select * from attention where incomplete order by section,name,id limit 5) x),'[]'),
 'below',coalesce((select jsonb_agg(jsonb_build_object('name',name,'section',section,'id',class_id)) from (select * from attention where below order by section,name,id limit 50) x),'[]'),
 'assessment',coalesce((select jsonb_agg(jsonb_build_object('name',name,'average',average,'entered',entered) order by name,id) from a),'[]'));
$$;
revoke all on function public.dashboard_summary(uuid) from public,anon;
grant execute on function public.dashboard_summary(uuid) to authenticated;


-- Correct text encoding for deployed dashboard labels.
-- One owner-scoped aggregate request; no score or full roster download.
create or replace function public.dashboard_summary(p_class uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with c as materialized(select * from public.classes where owner_id=auth.uid() and not archived and (p_class is null or id=p_class)),
e as materialized(select e.* from public.class_enrollments e join c on c.id=e.class_id),
t as materialized(select g.* from public.term_grades g join c on c.id=g.class_id),
f as materialized(select g.* from public.final_grades g join c on c.id=g.class_id),
valid as(select (result->>'grade')::numeric grade from t where not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean and result->>'grade' is not null),
attention as materialized(select e.id,e.name,c.section,c.id class_id,
 exists(select 1 from t where t.enrollment_id=e.id and ((result->>'incomplete')::boolean or (result->>'provisional')::boolean))
 or exists(select 1 from f where f.enrollment_id=e.id and ((result->>'incomplete')::boolean or (result->>'provisional')::boolean)) incomplete,
 exists(select 1 from t join public.grading_configurations cfg on cfg.class_id=t.class_id where t.enrollment_id=e.id and not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean and (result->>'grade')::numeric < cfg.passing_threshold) below
 from e join c on c.id=e.class_id),
a as(select a.id,c.section||' · '||a.name name,avg(s.value/a.maximum*100) average,count(s.value) entered from public.assessments a join c on c.id=a.class_id left join public.scores s on s.assessment_id=a.id group by a.id,c.section,a.name)
select jsonb_build_object(
 'classes',coalesce((select jsonb_agg(jsonb_build_object('info',to_jsonb(c),'learnerCount',(select count(*) from e where class_id=c.id)) order by c.section,c.id) from c),'[]'),
 'students',(select count(*) from e),'term',(select avg(grade) from valid),
 'final',(select avg((result->>'final')::numeric) from f where not (result->>'incomplete')::boolean and not (result->>'provisional')::boolean),
 'bins',(select jsonb_agg(jsonb_build_object('label',label,'count',(select count(*) from valid where grade>=lo and grade<hi)) order by lo) from (values('60–64',60,65),('65–74',65,75),('75–79',75,80),('80–89',80,90),('90–100',90,101)) b(label,lo,hi)),
 'incompleteCount',(select count(*) from attention where incomplete),'belowCount',(select count(*) from attention where below),
 'incomplete',coalesce((select jsonb_agg(jsonb_build_object('name',name,'section',section,'id',class_id)) from (select * from attention where incomplete order by section,name,id limit 5) x),'[]'),
 'below',coalesce((select jsonb_agg(jsonb_build_object('name',name,'section',section,'id',class_id)) from (select * from attention where below order by section,name,id limit 50) x),'[]'),
 'assessment',coalesce((select jsonb_agg(jsonb_build_object('name',name,'average',average,'entered',entered) order by name,id) from a),'[]'));
$$;
revoke all on function public.dashboard_summary(uuid) from public,anon;
grant execute on function public.dashboard_summary(uuid) to authenticated;
