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
