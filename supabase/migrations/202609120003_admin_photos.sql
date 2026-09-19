begin;
create function private.guard_owner() returns trigger language plpgsql set search_path='' as $$ begin
 perform 1 from public.users where id=new.owner_id and role='owner' for update;
 if not found then raise exception 'VALIDATION_ERROR';end if;return new;end $$;
create trigger owner_role before insert or update on public.property_owners for each row execute function private.guard_owner();
create function private.guard_property() returns trigger language plpgsql set search_path='' as $$ begin
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'VALIDATION_ERROR';end if;return new;end $$;
create trigger property_timezone before insert or update on public.properties for each row execute function private.guard_property();
create function public.bloom_admin_role(p_user uuid,p_role public.bloom_role,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;i jsonb:=jsonb_build_object('user',p_user,'role',p_role);begin
 u:=private.require_actor('admin');r:=private.receipt('admin_role',p_key,i);if r is not null then return r;end if;
 if p_user=u.id or p_role is null then raise exception 'FORBIDDEN';end if;
 perform 1 from public.users where id=p_user for update;if not found then raise exception 'NOT_FOUND';end if;
 if exists(select 1 from public.assignments where cleaner_id=p_user and ended_at is null) or exists(select 1 from public.property_owners where owner_id=p_user) then raise exception 'INVALID_STATE';end if;
 update public.users set role=p_role,updated_at=clock_timestamp() where id=p_user;
 select jsonb_build_object('id',id,'role',role,'displayName',display_name,'approvedCityId',approved_city_id) into r from public.users where id=p_user;
 return private.save_receipt('admin_role',p_key,i,r);end $$;
create function public.bloom_admin_properties(p_limit integer default 50,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform private.require_actor('admin');if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'VALIDATION_ERROR';end if;
 return (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from (select * from public.properties order by id limit p_limit offset p_offset)p);end $$;
create function public.bloom_admin_property(p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;i uuid; owner uuid;begin
 perform private.require_actor('admin');r:=private.receipt('admin_property',p_key,p_data);if r is not null then return r;end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('cityId','name','timezone','address','isBloomOwned','soloRateCents','ownerIds')) then raise exception 'VALIDATION_ERROR';end if;
 if coalesce(length(trim(p_data->>'name')),0)=0 or coalesce(length(trim(p_data->>'address')),0)=0 or jsonb_typeof(p_data->'ownerIds') is distinct from 'array' then raise exception 'VALIDATION_ERROR';end if;
 insert into public.properties(city_id,name,timezone,address,is_bloom_owned,solo_rate_cents) values((p_data->>'cityId')::uuid,p_data->>'name',p_data->>'timezone',p_data->>'address',(p_data->>'isBloomOwned')::boolean,(p_data->>'soloRateCents')::integer) returning id into i;
 for owner in select value::uuid from jsonb_array_elements_text(p_data->'ownerIds') loop insert into public.property_owners values(i,owner);end loop;
 select to_jsonb(p) into r from public.properties p where id=i;return private.save_receipt('admin_property',p_key,p_data,r);end $$;
create function private.photo_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'jobId',job_id,'uploaderId',uploader_id,'category',category,'createdAt',created_at,'state',state) from public.job_photos where id=p_id
$$;
create function public.bloom_photo_prepare(p_job uuid,p_category text,p_mime text,p_bytes integer,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb; photo uuid:=gen_random_uuid();i jsonb:=jsonb_build_object('job',p_job,'category',p_category,'mime',p_mime,'bytes',p_bytes);begin
 u:=private.require_actor('cleaner');
 perform 1 from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('photo_prepare',p_key,i);if r is not null then return r;end if;
 if p_category is null or p_category not in ('bedrooms','bathrooms','kitchen','living_room') or p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') or p_bytes is null or p_bytes not between 1 and 10485760 then raise exception 'VALIDATION_ERROR';end if;
 insert into public.job_photos(id,job_id,uploader_id,category,object_path,bytes,mime) values(photo,p_job,u.id,p_category,p_job::text||'/'||photo::text,p_bytes,p_mime);
 r:=jsonb_build_object('photoId',photo,'bucket','job-photos','path',p_job::text||'/'||photo::text);
 return private.save_receipt('photo_prepare',p_key,i,r);end $$;
create function public.bloom_photos(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform private.require_actor();if not private.photo_access(p_job) then raise exception 'NOT_FOUND';end if;
 return (select coalesce(jsonb_agg(private.photo_dto(id) order by created_at,id),'[]') from public.job_photos where job_id=p_job);end $$;
-- Only a server byte-validation path may finalize. Service role still supplies a verified
-- Clerk subject explicitly; no authenticated client is granted execution.
create function public.bloom_photo_finalize_verified(p_subject text,p_job uuid,p_photo uuid,p_bytes integer,p_mime text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;p public.job_photos;r jsonb;i jsonb:=jsonb_build_object('job',p_job,'photo',p_photo,'bytes',p_bytes,'mime',p_mime);begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN';end if;
 select * into u from public.users where clerk_user_id=p_subject and role='cleaner';if not found then raise exception 'FORBIDDEN';end if;
 perform 1 from public.jobs where id=p_job for update;
 if not exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where j.id=p_job and a.cleaner_id=u.id and a.ended_at is null and j.status='open' and not j.review_required) then raise exception 'NOT_FOUND';end if;
 select * into p from public.job_photos where id=p_photo and job_id=p_job and uploader_id=u.id for update;if not found then raise exception 'NOT_FOUND';end if;
 if p_bytes is distinct from p.bytes or p_mime is distinct from p.mime then raise exception 'VALIDATION_ERROR';end if;
 if p_key is null or length(p_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 select result into r from public.operation_receipts where actor_id=u.id and operation='photo_finalize' and idempotency_key=p_key and input_hash=i::text;
 if r is not null then return r;end if;
 if exists(select 1 from public.operation_receipts where actor_id=u.id and operation='photo_finalize' and idempotency_key=p_key) then raise exception 'CONFLICT';end if;
 update public.job_photos set state='ready' where id=p.id;
 r:=private.photo_dto(p.id);
 insert into public.operation_receipts(actor_id,operation,idempotency_key,input_hash,result) values(u.id,'photo_finalize',p_key,i::text,r);
 return r;end $$;
create function private.storage_upload(p_path text) returns boolean language plpgsql security definer set search_path='' as $$
declare p public.job_photos;begin
 select * into p from public.job_photos where object_path=p_path;if not found then return false;end if;
 -- Same lock as completion/withdrawal: upload authorization and lifecycle serialize.
 perform 1 from public.jobs where id=p.job_id for update;
 select * into p from public.job_photos where object_path=p_path;if not found then return false;end if;
 return p.uploader_id=(private.actor()).id and p.state='pending' and private.photo_access(p.job_id,true);end $$;
create function private.storage_read(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.job_photos p where p.object_path=p_path and private.photo_access(p.job_id))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('job-photos','job-photos',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy bloom_photo_upload on storage.objects for insert to authenticated with check(bucket_id='job-photos' and private.storage_upload(name));
create policy bloom_photo_read on storage.objects for select to authenticated using(bucket_id='job-photos' and private.storage_read(name));
-- No object UPDATE/DELETE policy: a pending or ready object cannot be overwritten.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.actor(),private.is_admin(),private.assigned(uuid),private.photo_access(uuid,boolean),private.storage_upload(text),private.storage_read(text) to authenticated;
revoke all on function public.bloom_admin_role(uuid,public.bloom_role,text),public.bloom_admin_properties(integer,integer),public.bloom_admin_property(jsonb,text),public.bloom_photo_prepare(uuid,text,text,integer,text),public.bloom_photos(uuid),public.bloom_photo_finalize_verified(text,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.bloom_admin_role(uuid,public.bloom_role,text),public.bloom_admin_properties(integer,integer),public.bloom_admin_property(jsonb,text),public.bloom_photo_prepare(uuid,text,text,integer,text),public.bloom_photos(uuid) to authenticated;
grant execute on function public.bloom_photo_finalize_verified(text,uuid,uuid,integer,text,text) to service_role;
commit;
