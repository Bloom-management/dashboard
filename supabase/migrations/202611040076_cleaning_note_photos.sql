begin;
alter table public.job_photos add column note_context text check(note_context in ('supplies','maintenance'));
create table private.job_notes (
 job_id uuid not null references public.jobs,author_id uuid not null references public.users,
 section text not null check(section in ('supplies','maintenance')),body text not null check(length(body)<=1500),
 updated_at timestamptz not null default now(),primary key(job_id,author_id,section)
);
alter table private.job_notes enable row level security;
revoke all on private.job_notes from public,anon,authenticated,service_role;
alter function private.photo_dto(uuid) rename to photo_dto_before_notes;
create function private.photo_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.photo_dto_before_notes(p_id)||jsonb_build_object('noteContext',note_context) from public.job_photos where id=p_id
$$;
revoke all on function private.photo_dto_before_notes(uuid),private.photo_dto(uuid) from public,anon,authenticated,service_role;
create function public.bloom_note_photo_prepare(p_job uuid,p_section text,p_mime text,p_bytes integer,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'section',p_section,'mime',p_mime,'bytes',p_bytes);begin
 u:=private.require_actor();
 if p_section is null or p_section not in ('supplies','maintenance') then raise exception 'VALIDATION_ERROR';end if;
 perform 1 from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('note_photo_prepare',p_key,input);if r is not null then return r;end if;
 r:=public.bloom_photo_prepare(p_job,'bedrooms',p_mime,p_bytes,p_key);
 update public.job_photos set note_context=p_section where id=(r->>'photoId')::uuid and uploader_id=u.id and room_id is null;
 return private.save_receipt('note_photo_prepare',p_key,input,r);
end $$;
create function public.bloom_job_notes(p_job uuid,p_section text,p_body text default null,p_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'section',p_section,'body',p_body);begin
 u:=private.require_actor();
 if p_section is null or p_section not in ('supplies','maintenance') then raise exception 'VALIDATION_ERROR';end if;
 if p_body is not null then
  perform 1 from public.jobs where id=p_job for update;
  if u.role not in ('cleaner','admin') or not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
  r:=private.receipt('job_note',p_key,input);if r is not null then return r;end if;
  if length(p_body)>1500 then raise exception 'VALIDATION_ERROR';end if;
  insert into private.job_notes(job_id,author_id,section,body) values(p_job,u.id,p_section,p_body)
  on conflict(job_id,author_id,section) do update set body=excluded.body,updated_at=now();
 else
  if not private.photo_access(p_job) then raise exception 'NOT_FOUND';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('authorId',n.author_id,'authorName',a.display_name,'body',n.body,'updatedAt',n.updated_at) order by n.updated_at),'[]') into r
 from private.job_notes n join public.users a on a.id=n.author_id where n.job_id=p_job and n.section=p_section;
 if p_body is not null then return private.save_receipt('job_note',p_key,input,r);end if;
 return r;
end $$;
revoke all on function public.bloom_note_photo_prepare(uuid,text,text,integer,text),public.bloom_job_notes(uuid,text,text,text) from public,anon;
grant execute on function public.bloom_note_photo_prepare(uuid,text,text,integer,text),public.bloom_job_notes(uuid,text,text,text) to authenticated;
commit;
