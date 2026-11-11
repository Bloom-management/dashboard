#!/usr/bin/env python3
"""Idempotent preparation in the existing local Docker database only. No invitation delivery."""
import json,subprocess,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
container='supabase_db_bloom-backend-local'
info=json.loads(subprocess.check_output(['docker','inspect',container]))[0]
assert info['State']['Running'] and info['HostConfig']['PortBindings']['5432/tcp'][0]['HostPort']=='55442'
def lit(v):return 'null' if v is None else "'"+v.replace("'","''")+"'"
covers=json.loads((ROOT/'scripts/room-listings/atam-covers.json').read_text())
supplies={
'Bathroom stock':['Toilet paper','Body soap','Conditioner'],
'Kitchen stock':['Paper towels','Dish soap','Dishwasher detergent','Kitchen trash bags'],
'Cleaning stock':['All-purpose cleaner','Bathroom cleaner','Glass cleaner','Sponges/scrub pads','Cleaning cloths'],
'Laundry stock':['Laundry detergent'],
'Guest consumables':['Coffee','Cooking oil','Salt','Pepper'],
'Linen stock':['Clean bath towels','Hand towels','Washcloths','Bed sheets','Pillowcases']}
maintenance={
'Shared bathroom':['Bathtub, faucet, and drain','Toilet','Sink and faucet','Hot water','Hair dryer','Walls and paint'],
'Shared kitchen':['Refrigerator and freezer','Stove and oven','Microwave','Dishwasher','Sink, faucet, and drain','Coffee maker','Kettle and toaster','Trash compactor','Cabinets, counters, and dining furniture'],
'Shared house/laundry':['Washer and dryer','Heating and air conditioning','Wi-Fi','Shared lighting and electrical outlets','Shared doors and entry lock','Shared walls and paint','Smoke alarms and carbon monoxide alarms','Fire extinguisher and first aid kit','Iron and drying rack'],
'Shared outdoor':['Backyard','Fire pit','Outdoor furniture']}
room_items=['Bedroom door, lock, and keypad','Bed frame and mattress','Walls and paint','Windows and room-darkening shades','Clothing storage','Lighting and electrical outlets']
sql="""begin;
select pg_advisory_xact_lock(hashtextextended('prepare-atam-room-drafts',0));
do $$ declare h uuid;pid uuid;admin_id uuid;sid uuid;begin
select id into admin_id from public.users where role='admin' order by created_at limit 1;
if admin_id is null then raise exception 'An existing local admin is required';end if;
-- Refuse ambiguous pre-existing data instead of taking ownership or rewriting rates.
if exists(select 1 from public.properties where (address ilike '%4903%Lincoln%' or airbnb_listing_url in ('https://www.airbnb.com/rooms/1190187638631372725','https://www.airbnb.com/rooms/1190189243127995944','https://www.airbnb.com/rooms/1190172062840895435','https://www.airbnb.com/rooms/1190191672497242825')) and house_id is null and deleted_at is null) then raise exception 'Existing listings require explicit reconciliation';end if;
if exists(select 1 from public.properties p join public.houses house on house.id=p.house_id where p.airbnb_listing_url in ('https://www.airbnb.com/rooms/1190187638631372725','https://www.airbnb.com/rooms/1190189243127995944','https://www.airbnb.com/rooms/1190172062840895435','https://www.airbnb.com/rooms/1190191672497242825') and p.deleted_at is null and house.address<>'4903 Lincoln Blvd, Dearborn Heights, MI 48125') then raise exception 'Existing listing house requires explicit reconciliation';end if;
select id into h from public.houses where address='4903 Lincoln Blvd, Dearborn Heights, MI 48125';
if h is null then insert into public.houses(name,address,timezone,created_by) values('Dearborn','4903 Lincoln Blvd, Dearborn Heights, MI 48125','America/Detroit',admin_id) returning id into h;end if;
"""
for label,kind in [('Shared bathroom','bathroom'),('Shared kitchen','kitchen'),('Shared living room','living_room'),('Shared house/laundry','house_laundry'),('Shared outdoor','outdoor')]:
 sql+=f"insert into public.house_spaces(house_id,kind,label) select h,{lit(kind)},{lit(label)} where not exists(select 1 from public.house_spaces where house_id=h and property_id is null and kind={lit(kind)}) on conflict do nothing;\n"
for c in covers:
 draft=json.dumps({'name':c['title'],'identifier':c['identifier'],'label':'','instructions':'','reviewSuggestions':['Confirm elevator before adding maintenance']})
 sql+=f"""
select id into pid from public.properties where house_id=h and airbnb_listing_url={lit(c['url'])};
if pid is null then
 insert into public.properties(city_id,name,address,timezone,active,is_bloom_owned,solo_rate_cents,house_id,listing_type,room_identifier,draft_data,airbnb_listing_url,airbnb_cover_url,airbnb_cover_status)
 values('00000000-0000-4000-8000-000000000001',{lit(c['title'])},'4903 Lincoln Blvd, Dearborn Heights, MI 48125','America/Detroit',false,false,4500,h,'room',{lit(c['identifier'])},{lit(draft)}::jsonb,{lit(c['url'])},{lit(c['image'])},{lit(c['status'])}) returning id into pid;
 insert into private.pending_property_owners(property_id,email,created_by) values(pid,'atampreet88@gmail.com',admin_id);
end if;
insert into public.property_entry_instructions(property_id,instructions,access_info) values(pid,'','{{"entryType":"keypad","code":"","entryNotes":"","parking":[],"garageCode":"","parkingNotes":""}}'::jsonb) on conflict(property_id) do nothing;
insert into public.house_spaces(house_id,property_id,kind,label) select h,pid,'bedroom',{lit(c['identifier'])} where not exists(select 1 from public.house_spaces where house_id=h and property_id=pid and kind='bedroom') on conflict do nothing;
select id into sid from public.house_spaces where house_id=h and property_id=pid and kind='bedroom';
insert into public.listing_spaces(property_id,space_id) select pid,id from public.house_spaces where house_id=h and (property_id is null or property_id=pid) on conflict do nothing;
"""
 if c.get('candidateImage'):
  sql+=f"update public.properties set airbnb_cover_url=null,airbnb_cover_status='unavailable',airbnb_cover_revision=airbnb_cover_revision+1 where id=pid and airbnb_cover_status='extracted' and airbnb_cover_url={lit(c['candidateImage'])};\n"
 for item in room_items+(['TV','Workspace furniture'] if c['identifier'] in ('DH2','DH4') else []):
  sql+=f"insert into public.house_items(house_id,property_id,space_id,kind,category,name) values(h,pid,sid,'maintenance','Bedroom',{lit(item)}) on conflict do nothing;\n"
for kind,groups in [('supply',supplies),('maintenance',maintenance)]:
 for group,items in groups.items():
  for item in items:
   sql+=f"insert into public.house_items(house_id,kind,category,name) values(h,{lit(kind)},{lit(group)},{lit(item)}) on conflict do nothing;\n"
sql+="""
insert into public.house_visit_pricing(house_id,first_host_cents,additional_host_cents,first_pool_cents,additional_pool_cents) values(h,6500,2500,4500,2000) on conflict do nothing;
end $$;
commit;
select p.room_identifier,p.active,p.airbnb_cover_status,p.address,(select count(*) from public.calendar_sources where property_id=p.id) calendars,(select count(*) from public.jobs where property_id=p.id) jobs from public.properties p join public.houses h on h.id=p.house_id where h.address='4903 Lincoln Blvd, Dearborn Heights, MI 48125' and p.deleted_at is null order by p.room_identifier;
"""
subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],input=sql,text=True,check=True)
