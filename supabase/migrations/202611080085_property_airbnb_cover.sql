begin;
alter table public.properties add column airbnb_listing_url text,add column airbnb_cover_url text,
 add column airbnb_cover_status text not null default 'none' check(airbnb_cover_status in ('none','extracted','manual','unavailable')),
 add column airbnb_cover_revision integer not null default 0;
create function public.bloom_property_airbnb(p_property uuid,p_write boolean default false,p_url text default null,p_image text default null,p_status text default null,p_revision integer default null,p_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
-- Hash the user's intent, not a transient extraction result, so a lost-response
-- retry still succeeds if Airbnb subsequently blocks the metadata fetch.
declare u public.users;p public.properties;r jsonb;input jsonb:=jsonb_build_object('property',p_property,'url',p_url,'manual',case when p_status='manual' then p_image else null end,'revision',p_revision);begin
 u:=private.require_actor();
 if p_write then
  select * into p from public.properties where id=p_property and deleted_at is null for update;
  if p.id is null or u.role not in ('owner','admin') or not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
  r:=private.receipt('property_airbnb',p_key,input);if r is not null then return r;end if;
  if p_revision is distinct from p.airbnb_cover_revision then raise exception 'CONFLICT';end if;
  if p_url is not null and (length(p_url)>2048 or p_url !~ '^https://www[.]airbnb[.]com/rooms/[0-9]+$') then raise exception 'VALIDATION_ERROR';end if;
  if p_image is not null and (length(p_image)>2048 or p_image !~ '^https://a[0-9][.]muscache[.]com/(im/)?pictures/') then raise exception 'VALIDATION_ERROR';end if;
  if p_status is null or p_status not in ('none','extracted','manual','unavailable')
   or (p_url is null and (p_image is not null or p_status<>'none'))
   or (p_url is not null and p_status='none')
   or (p_status in ('extracted','manual') and (p_url is null or p_image is null))
   or (p_status in ('none','unavailable') and p_image is not null) then raise exception 'VALIDATION_ERROR';end if;
  if p.airbnb_listing_url is distinct from p_url then delete from public.property_thumbnails where property_id=p_property;end if;
  update public.properties set airbnb_listing_url=p_url,airbnb_cover_url=p_image,airbnb_cover_status=p_status,airbnb_cover_revision=airbnb_cover_revision+1 where id=p_property returning * into p;
 else
  if not private.thumbnail_access(p_property) then raise exception 'NOT_FOUND';end if;
  select * into p from public.properties where id=p_property and deleted_at is null;
 end if;
 r:=jsonb_build_object('listingUrl',p.airbnb_listing_url,'image',case when p.airbnb_listing_url is not null then p.airbnb_cover_url else (select image from public.property_thumbnails where property_id=p_property) end,'status',p.airbnb_cover_status,'revision',p.airbnb_cover_revision,'canEdit',u.role in ('owner','admin') and private.people_access(p_property,u.id));
 if p_write then return private.save_receipt('property_airbnb',p_key,input,r);end if;return r;
end $$;
revoke all on function public.bloom_property_airbnb(uuid,boolean,text,text,text,integer,text) from public,anon;
grant execute on function public.bloom_property_airbnb(uuid,boolean,text,text,text,integer,text) to authenticated;
commit;
