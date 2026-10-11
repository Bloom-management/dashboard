begin;
create table public.property_thumbnails (
 property_id uuid primary key references public.properties(id) on delete cascade,
 image text not null check(length(image)<=16000 and image ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')
);
alter table public.property_thumbnails enable row level security;
grant select on public.property_thumbnails to authenticated;
create function private.thumbnail_access(p_property uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.properties p where p.id=p_property and p.deleted_at is null and (private.people_access(p.id,(private.actor()).id) or exists(select 1 from public.jobs j where j.property_id=p.id and private.job_visible(j.id))))
$$;
revoke all on function private.thumbnail_access(uuid) from public,anon;
grant execute on function private.thumbnail_access(uuid) to authenticated;
create policy thumbnail_read on public.property_thumbnails for select to authenticated using(private.thumbnail_access(property_id));
create function public.bloom_property_thumbnail(p_property uuid,p_image text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;input jsonb:=jsonb_build_object('property',p_property,'image',p_image);begin
 u:=private.require_actor();
 perform 1 from public.properties where id=p_property and deleted_at is null for update;
 if not found or not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('property_thumbnail',p_key,input);if r is not null then return r;end if;
 if p_image is null then delete from public.property_thumbnails where property_id=p_property;
 else
 if length(p_image)>16000 or p_image !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then raise exception 'VALIDATION_ERROR';end if;
 insert into public.property_thumbnails values(p_property,p_image) on conflict(property_id) do update set image=excluded.image;
 end if;
 return private.save_receipt('property_thumbnail',p_key,input,jsonb_build_object('image',p_image));end$$;
revoke all on function public.bloom_property_thumbnail(uuid,text,text) from public,anon;
grant execute on function public.bloom_property_thumbnail(uuid,text,text) to authenticated;
commit;
