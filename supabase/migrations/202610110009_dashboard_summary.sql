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
