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
