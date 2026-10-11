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
