begin;
-- Cleaners may remove their own room photos (not only note attachments) while the job is open.
-- A removed room photo returns to pending, so every coverage check (state='ready') stops counting it
-- and the trusted pending-photo cleanup deletes its bytes. note_removed_at hides it from bloom_photos.
create or replace function public.bloom_note_photo_remove(p_job uuid,p_photo uuid,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;p public.job_photos;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'photo',p_photo);begin
 u:=private.require_actor();
 perform 1 from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('note_photo_remove',p_key,input);if r is not null then return r;end if;
 select * into p from public.job_photos where id=p_photo and job_id=p_job and uploader_id=u.id for update;
 if p.id is null then raise exception 'NOT_FOUND';end if;
 update public.job_photos set note_removed_at=coalesce(note_removed_at,now()),state=case when note_context is null then 'pending' else state end where id=p.id;
 return private.save_receipt('note_photo_remove',p_key,input,jsonb_build_object('removed',true));
end $$;
revoke all on function public.bloom_note_photo_remove(uuid,uuid,text) from public,anon;
grant execute on function public.bloom_note_photo_remove(uuid,uuid,text) to authenticated;
commit;
