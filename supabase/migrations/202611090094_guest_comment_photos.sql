begin;
-- Guest comments can carry photos, stored like supply/maintenance note photos with note_context 'guest'.
alter table public.job_photos drop constraint job_photos_note_context_check;
alter table public.job_photos add constraint job_photos_note_context_check check(note_context in ('supplies','maintenance','guest'));
create or replace function public.bloom_note_photo_prepare(p_job uuid,p_section text,p_mime text,p_bytes integer,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'section',p_section,'mime',p_mime,'bytes',p_bytes);begin
 u:=private.require_actor();
 if p_section is null or p_section not in ('supplies','maintenance','guest') then raise exception 'VALIDATION_ERROR';end if;
 perform 1 from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('note_photo_prepare',p_key,input);if r is not null then return r;end if;
 r:=public.bloom_photo_prepare(p_job,'bedrooms',p_mime,p_bytes,p_key);
 update public.job_photos set note_context=p_section where id=(r->>'photoId')::uuid and uploader_id=u.id and room_id is null;
 return private.save_receipt('note_photo_prepare',p_key,input,r);
end $$;
commit;
