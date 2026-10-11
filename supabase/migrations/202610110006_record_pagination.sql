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
