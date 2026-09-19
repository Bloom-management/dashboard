begin;
create function public.bloom_photo_read_receipt(p_job uuid,p_photo uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i jsonb:=jsonb_build_object('job',p_job,'photo',p_photo);r jsonb;begin
 perform private.require_actor();
 if not private.photo_access(p_job) or not exists(select 1 from public.job_photos where id=p_photo and job_id=p_job and state='ready') then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('photo_read',p_key,i);if r is not null then return r;end if;
 return private.save_receipt('photo_read',p_key,i,jsonb_build_object('photoId',p_photo));end $$;
revoke all on function public.bloom_photo_read_receipt(uuid,uuid,text) from public,anon;
grant execute on function public.bloom_photo_read_receipt(uuid,uuid,text) to authenticated;
commit;
