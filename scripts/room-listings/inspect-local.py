#!/usr/bin/env python3
"""Read-only local handoff verification. Does not inspect hosted data."""
import subprocess
sql="""
select p.room_identifier,p.active,p.draft_data is not null as draft,p.airbnb_listing_url,p.airbnb_cover_status,p.address,p.timezone,
 (select count(*) from public.calendar_sources s where s.property_id=p.id) calendars,
 (select count(*) from public.jobs j where j.property_id=p.id) jobs,
 (select email from private.pending_property_owners o where o.property_id=p.id) pending_owner
from public.properties p join public.houses h on h.id=p.house_id where h.address='4903 Lincoln Blvd, Dearborn Heights, MI 48125' and p.deleted_at is null order by p.room_identifier;
select count(*) houses,count(latitude) geocoded from public.houses where address='4903 Lincoln Blvd, Dearborn Heights, MI 48125';
select kind,count(*) definitions,count(r.id) reports from public.house_items i join public.houses h on h.id=i.house_id left join public.house_item_reports r on r.item_id=i.id where h.address='4903 Lincoln Blvd, Dearborn Heights, MI 48125' group by kind;
select first_host_cents,additional_host_cents,first_pool_cents,additional_pool_cents from public.house_visit_pricing v join public.houses h on h.id=v.house_id where h.address='4903 Lincoln Blvd, Dearborn Heights, MI 48125';
"""
subprocess.run(['docker','exec','-i','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],input=sql,text=True,check=True)
