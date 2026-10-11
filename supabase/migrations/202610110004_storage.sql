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
