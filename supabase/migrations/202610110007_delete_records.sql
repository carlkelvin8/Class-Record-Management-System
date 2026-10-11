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
