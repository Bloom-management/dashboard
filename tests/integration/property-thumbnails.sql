-- Run inside a transaction after migration 065; synthetic local JWT claims.
create temporary table thumbnail_fixture as select p.id,po.owner_id from public.properties p join public.property_owners po on po.property_id=p.id where p.active and p.deleted_at is null limit 1;
do $$begin if not exists(select 1 from thumbnail_fixture) then raise exception 'Need owner/property fixture';end if;end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',u.clerk_user_id)::text,true) from public.users u join thumbnail_fixture f on f.owner_id=u.id;
do $$declare f record;r jsonb;begin
 select * into f from thumbnail_fixture;
 r:=public.bloom_property_thumbnail(f.id,'data:image/jpeg;base64,/9j/','thumbnail-test');
 if public.bloom_property_thumbnail(f.id,'data:image/jpeg;base64,/9j/','thumbnail-test')<>r then raise exception 'Retry mismatch';end if;
 begin perform public.bloom_property_thumbnail(f.id,'data:image/svg+xml;base64,AAAA','bad-thumbnail');raise exception 'Unsafe format accepted';exception when others then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',u.clerk_user_id)::text,true) from public.users u where u.role='owner' and not exists(select 1 from public.property_owners po join thumbnail_fixture f on f.id=po.property_id where po.owner_id=u.id) limit 1;
do $$begin
 begin perform public.bloom_property_thumbnail((select id from thumbnail_fixture),null,'cross-owner-thumbnail');raise exception 'Cross-owner write accepted';exception when others then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
end$$;
set local role authenticated;
do $$begin if exists(select 1 from public.property_thumbnails where image='data:image/jpeg;base64,/9j/') then raise exception 'Cross-owner read accepted';end if;end$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',clerk_user_id)::text,true) from public.users where role='admin' limit 1;
do $$begin perform public.bloom_property_thumbnail((select id from thumbnail_fixture),null,'admin-thumbnail-remove');if exists(select 1 from public.property_thumbnails where property_id=(select id from thumbnail_fixture)) then raise exception 'Removal failed';end if;end$$;
