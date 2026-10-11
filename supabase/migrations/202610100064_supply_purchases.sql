begin;
create table private.supply_purchases (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties,
 supply_id uuid not null, product_name text not null, product_url text, image_url text,
 cost_cents integer not null check(cost_cents between 0 and 100000000), purchase_date date not null,
 restocked_date date check(restocked_date>=purchase_date), restocked_at timestamptz, created_at timestamptz not null default now(),
 recorded_by uuid not null references public.users
);
create index supply_purchase_history on private.supply_purchases(property_id,supply_id,purchase_date desc,created_at desc);
revoke all on private.supply_purchases from public,anon,authenticated,service_role;
create function public.bloom_supply_purchases(p_property uuid,p_supply uuid,p_input jsonb default null,p_key text default null,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.users;r jsonb;v jsonb;day date;event_id uuid;effective_at timestamptz;fingerprint jsonb;begin
 actor:=private.require_actor();
 if not private.people_access(p_property,actor.id) then raise exception 'NOT_FOUND';end if;
 select (now() at time zone timezone)::date into day from public.properties where id=p_property;
 if not exists(select 1 from public.properties p cross join lateral jsonb_array_elements(p.cleaning_config->'supplies') s where p.id=p_property and s->>'id'=p_supply::text) then raise exception 'NOT_FOUND';end if;
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'VALIDATION_ERROR';end if;
 if p_input is not null then
  fingerprint:=jsonb_build_object('property',p_property,'supply',p_supply,'input',p_input);
  r:=private.receipt('supply_purchase',p_key,fingerprint);if r is not null then return r;end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'VALIDATION_ERROR';end if;
  if p_input->>'restockedDate' is not null then
   if coalesce(p_input->>'restockedDate','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'VALIDATION_ERROR';end if;
   select case when (p_input->>'restockedDate')::date=day then now() else ((p_input->>'restockedDate')::date::timestamp at time zone timezone) end into effective_at from public.properties where id=p_property;
  end if;
  if p_input ? 'restockId' then
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('restockId','restockedDate')) then raise exception 'VALIDATION_ERROR';end if;
   if coalesce(p_input->>'restockedDate','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_input->>'restockedDate')::date>day then raise exception 'VALIDATION_ERROR';end if;
   update private.supply_purchases set restocked_date=(p_input->>'restockedDate')::date,restocked_at=effective_at where id=(p_input->>'restockId')::uuid and property_id=p_property and supply_id=p_supply and restocked_date is null and purchase_date<=(p_input->>'restockedDate')::date returning id into event_id;
   if event_id is null then raise exception 'CONFLICT';end if;
  else
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('productName','productUrl','imageUrl','costCents','purchaseDate','restockedDate'))
    or jsonb_typeof(p_input->'productName') is distinct from 'string' or length(trim(p_input->>'productName')) not between 1 and 200
    or jsonb_typeof(p_input->'costCents') is distinct from 'number' or (p_input->>'costCents') !~ '^\d+$' or (p_input->>'costCents')::numeric>100000000
    or coalesce(p_input->>'purchaseDate','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_input->>'purchaseDate')::date>day then raise exception 'VALIDATION_ERROR';end if;
   for v in select p_input->k from unnest(array['productUrl','imageUrl']) k loop
    if v is not null and v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or length(v#>>'{}')>2048 or (v#>>'{}') !~ '^https://[^[:space:]<>]+$') then raise exception 'VALIDATION_ERROR';end if;
   end loop;
   if p_input->>'restockedDate' is not null and ((p_input->>'restockedDate') !~ '^\d{4}-\d{2}-\d{2}$' or (p_input->>'restockedDate')::date>day or (p_input->>'restockedDate')::date<(p_input->>'purchaseDate')::date) then raise exception 'VALIDATION_ERROR';end if;
   insert into private.supply_purchases(property_id,supply_id,product_name,product_url,image_url,cost_cents,purchase_date,restocked_date,restocked_at,recorded_by)
    values(p_property,p_supply,trim(p_input->>'productName'),p_input->>'productUrl',p_input->>'imageUrl',(p_input->>'costCents')::integer,(p_input->>'purchaseDate')::date,(p_input->>'restockedDate')::date,effective_at,actor.id) returning id into event_id;
  end if;
  return private.save_receipt('supply_purchase',p_key,fingerprint,jsonb_build_object('id',event_id));
 end if;
 with rows as (select x.*,u.display_name from private.supply_purchases x join public.users u on u.id=x.recorded_by where x.property_id=p_property and x.supply_id=p_supply order by x.purchase_date desc,x.created_at desc,x.id desc offset p_offset limit 21),shown as(select * from rows order by purchase_date desc,created_at desc,id desc limit 20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'productName',product_name,'productUrl',product_url,'imageUrl',image_url,'costCents',cost_cents,'purchaseDate',purchase_date,'restockedDate',restocked_date,'createdAt',created_at,'recordedBy',display_name) order by purchase_date desc,created_at desc,id desc) from shown),'[]'::jsonb),'nextOffset',case when (select count(*) from rows)>20 then p_offset+20 else null end) into r;
 return r;
end $$;
revoke all on function public.bloom_supply_purchases(uuid,uuid,jsonb,text,integer) from public,anon;
grant execute on function public.bloom_supply_purchases(uuid,uuid,jsonb,text,integer) to authenticated;
-- Keep cleaner reports immutable. Overlay only restocks newer than the latest
-- cleaner report, using property-local dates for backdated purchases/restocks.
alter function private.bloom_owner_listings(uuid) rename to owner_listings_before_restocks;
create function private.bloom_owner_listings(p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;item jsonb;supply jsonb;items jsonb:='[]';supplies jsonb;restock date;restock_at timestamptz;begin
 r:=private.owner_listings_before_restocks(p_cursor);
 for item in select value from jsonb_array_elements(r->'items') loop
  supplies:='[]';
  for supply in select value from jsonb_array_elements(item->'supplies') loop
   select max(restocked_date),max(restocked_at) into restock,restock_at from private.supply_purchases where property_id=(item->>'id')::uuid and supply_id=(supply->>'supplyId')::uuid;
   if restock is not null then
    supply:=supply||jsonb_build_object('lastRestockedDate',restock);
    if supply->>'reportedAt' is null or restock_at>(supply->>'reportedAt')::timestamptz then supply:=supply||jsonb_build_object('level','full','restockIsLatest',true);end if;
   end if;
   supplies:=supplies||jsonb_build_array(supply);
  end loop;
  items:=items||jsonb_build_array(jsonb_set(item,'{supplies}',supplies));
 end loop;
 return jsonb_set(r,'{items}',items);
end $$;
revoke all on function private.owner_listings_before_restocks(uuid),private.bloom_owner_listings(uuid) from public,anon,authenticated,service_role;
commit;
