-- Multiple supported provider feeds per owned listing; retain ownership and receipt checks.
begin;
create or replace function private.owner_calendar_property(p_actor uuid,p_property uuid,p_source uuid default null)
returns public.properties language plpgsql security definer set search_path='' as $$
declare p public.properties;begin
 if auth.role() is distinct from 'service_role' or current_setting('role',true) is distinct from 'service_role' or p_actor is null then perform private.calendar_error('FORBIDDEN');end if;
 select * into p from public.properties where id=p_property and deleted_at is null for update;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 perform 1 from public.users where id=p_actor and role='owner' for share;
 if not found then perform private.calendar_error('FORBIDDEN');end if;
 perform 1 from public.property_owners where property_id=p_property and owner_id=p_actor for share;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 if p_source is not null and not exists(select 1 from public.calendar_sources where id=p_source and property_id=p_property and provider in ('airbnb','vrbo')) then perform private.calendar_error('NOT_FOUND');end if;
 return p;
end $$;

create or replace function public.bloom_owner_calendar_add_source(p_actor uuid,p_property uuid,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor_key text;pid uuid;prov text;fp text;dig text;cipher text;p public.properties;s public.calendar_sources;r public.calendar_operation_receipts;h text;result jsonb;begin
 p:=private.owner_calendar_property(p_actor,p_property);v_actor_key:=p_actor::text;
 perform private.calendar_object(p_input,array['propertyId','provider','encryptedUrl','fingerprint','urlDigest']);
 begin pid:=private.calendar_text(p_input->'propertyId',36,36)::uuid;exception when others then perform private.calendar_error('VALIDATION_ERROR');end;
 prov:=private.calendar_text(p_input->'provider',4,6);fp:=private.calendar_text(p_input->'fingerprint',64,64);dig:=private.calendar_text(p_input->'urlDigest',64,64);cipher:=private.calendar_text(p_input->'encryptedUrl',40,16384);
 if pid is distinct from p_property or prov not in ('airbnb','vrbo') or fp !~ '^[a-f0-9]{64}$' or dig !~ '^[a-f0-9]{64}$' or cipher !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' then perform private.calendar_error('VALIDATION_ERROR');end if;

 if not p.active or not exists(select 1 from pg_timezone_names where name=p.timezone) then perform private.calendar_error('VALIDATION_ERROR');end if;
 perform private.calendar_key(v_actor_key,'add_source',p_key);
 h:=private.calendar_hash(p_input-'encryptedUrl');
 select * into r from public.calendar_operation_receipts cr where cr.actor_key=v_actor_key and operation='add_source' and idempotency_key=p_key;
 if found then if r.input_hash<>h then perform private.calendar_error('CONFLICT');end if;return r.result;end if;
 select * into s from public.calendar_sources where property_id=pid and provider=prov and fingerprint=fp for update;
 if not found then
 insert into public.calendar_sources(property_id,provider,encrypted_url,fingerprint,url_digest) values(pid,prov,cipher,fp,dig) returning * into s;
 elsif s.url_digest<>dig then
 if s.active_run_id is not null then update public.calendar_sync_runs set status='failed',error_code='SYNC_FAILED',completed_at=clock_timestamp() where id=s.active_run_id and status='running';end if;
 update public.calendar_sources set encrypted_url=cipher,url_digest=dig,sync_version=sync_version+1,active_run_id=null,lease_expires_at=null,etag=null,last_modified=null,updated_at=clock_timestamp() where id=s.id;
 end if;
 result:=private.calendar_health(s.id);
 insert into public.calendar_operation_receipts(actor_key,operation,idempotency_key,input_hash,result) values(v_actor_key,'add_source',p_key,h,result);return result;
end $$;
commit;
