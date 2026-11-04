begin;
alter table public.job_photos add column note_removed_at timestamptz;
create function public.bloom_note_photo_remove(p_job uuid,p_photo uuid,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;p public.job_photos;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'photo',p_photo);begin
 u:=private.require_actor();
 perform 1 from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('note_photo_remove',p_key,input);if r is not null then return r;end if;
 select * into p from public.job_photos where id=p_photo and job_id=p_job and uploader_id=u.id and note_context is not null for update;
 if p.id is null then raise exception 'NOT_FOUND';end if;
 update public.job_photos set note_removed_at=coalesce(note_removed_at,now()) where id=p.id;
 return private.save_receipt('note_photo_remove',p_key,input,jsonb_build_object('removed',true));
end $$;
create or replace function public.bloom_photos(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_actor();if not private.photo_access(p_job) then raise exception 'NOT_FOUND';end if;
 return(select coalesce(jsonb_agg(private.photo_dto(id) order by created_at,id),'[]') from public.job_photos where job_id=p_job and note_removed_at is null);
end $$;
revoke all on function public.bloom_note_photo_remove(uuid,uuid,text) from public,anon;
grant execute on function public.bloom_note_photo_remove(uuid,uuid,text) to authenticated;
commit;
