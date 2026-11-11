begin;
-- Room visits: a "Needs attention" maintenance report can carry a short comment and note photos,
-- matching the whole-home maintenance check.
alter table public.house_item_reports add column notes text check(notes is null or length(notes)<=500);

-- Read (p_item null) this visit's comments on flagged items, or save the comment on the item's latest report.
create function public.bloom_visit_item_notes(p_job uuid,p_item uuid default null,p_notes text default null,p_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;rep public.house_item_reports;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'item',p_item,'notes',p_notes);begin
 u:=private.require_actor();
 select * into j from public.jobs where id=p_job;
 if j.id is null or j.house_id is null then raise exception 'NOT_FOUND';end if;
 if p_item is null then
  if not private.photo_access(p_job) then raise exception 'NOT_FOUND';end if;
  return coalesce((select jsonb_object_agg(x.item_id,x.notes) from (select distinct on(item_id) item_id,notes,value from public.house_item_reports where job_id=p_job order by item_id,revision desc) x where x.value='issue' and x.notes is not null),'{}'::jsonb);
 end if;
 perform 1 from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('visit_item_note',p_key,input);if r is not null then return r;end if;
 if p_notes is null or length(p_notes)>500 then raise exception 'VALIDATION_ERROR';end if;
 select * into rep from public.house_item_reports where job_id=p_job and item_id=p_item order by revision desc limit 1 for update;
 if rep.id is null or rep.value<>'issue' then raise exception 'INVALID_STATE';end if;
 update public.house_item_reports set notes=nullif(trim(p_notes),'') where id=rep.id;
 return private.save_receipt('visit_item_note',p_key,input,jsonb_build_object('itemId',p_item,'notes',nullif(trim(p_notes),'')));
end $$;

-- Note photo for one maintenance item: a maintenance note photo whose room_id is the house item.
create function public.bloom_item_photo_prepare(p_job uuid,p_item uuid,p_mime text,p_bytes integer,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'item',p_item,'mime',p_mime,'bytes',p_bytes);begin
 u:=private.require_actor();
 perform 1 from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 if not exists(select 1 from public.house_items i join public.jobs j on j.house_id=i.house_id where j.id=p_job and i.id=p_item and i.kind='maintenance' and i.active) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('item_photo_prepare',p_key,input);if r is not null then return r;end if;
 r:=public.bloom_photo_prepare(p_job,'bedrooms',p_mime,p_bytes,p_key);
 update public.job_photos set note_context='maintenance',room_id=p_item where id=(r->>'photoId')::uuid and uploader_id=u.id and room_id is null;
 return private.save_receipt('item_photo_prepare',p_key,input,r);
end $$;

revoke all on function public.bloom_visit_item_notes(uuid,uuid,text,text),public.bloom_item_photo_prepare(uuid,uuid,text,integer,text) from public,anon;
grant execute on function public.bloom_visit_item_notes(uuid,uuid,text,text),public.bloom_item_photo_prepare(uuid,uuid,text,integer,text) to authenticated;
commit;
