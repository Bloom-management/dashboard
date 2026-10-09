begin;
create or replace function public.bloom_cleaning_report(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;j public.jobs;begin
 u:=private.require_actor();
 select * into j from public.jobs where id=p_job and status='completed';
 if j.id is null or not (private.people_access(j.property_id,u.id) or private.assigned(j.id)) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('jobId',j.id,'propertyName',(select name from public.properties where id=j.property_id),'date',j.checkout_date,'receipt',j.completion_receipt);
end $$;
revoke all on function public.bloom_cleaning_report(uuid) from public,anon;
grant execute on function public.bloom_cleaning_report(uuid) to authenticated;
commit;
