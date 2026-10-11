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
