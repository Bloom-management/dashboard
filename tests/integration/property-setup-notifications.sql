-- Transactional local acceptance after applying migration 068 in the same transaction.
create temporary table setup_fixture as select p.id,po.owner_id,p.cleaning_config from public.properties p join public.property_owners po on po.property_id=p.id where p.active and p.deleted_at is null limit 1;
do $$begin if not exists(select 1 from setup_fixture) then raise exception 'Missing fixture';end if;end$$;
update public.properties set cleaning_config=null where id=(select id from setup_fixture);
select set_config('request.jwt.claims',jsonb_build_object('sub',u.clerk_user_id)::text,true) from public.users u join setup_fixture f on f.owner_id=u.id;
do $$declare n integer;begin
 select count(*) into n from private.inbox_items() where id='property:setup:'||(select id from setup_fixture);
 if n<>1 then raise exception 'Owner reminder missing or duplicated';end if;
 if not exists(select 1 from private.inbox_items() where id='property:setup:'||(select id from setup_fixture) and href like '/owner?view=listings%section=settings' and not dismissible) then raise exception 'Owner destination wrong';end if;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',clerk_user_id)::text,true) from public.users where role='admin' limit 1;
do $$begin if not exists(select 1 from private.inbox_items() where id='property:setup:'||(select id from setup_fixture) and href like '/admin?view=properties%section=settings') then raise exception 'Admin reminder missing';end if;end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',u.clerk_user_id)::text,true) from public.users u where role='owner' and not exists(select 1 from public.property_owners po where po.property_id=(select id from setup_fixture) and po.owner_id=u.id) limit 1;
do $$begin if exists(select 1 from private.inbox_items() where id='property:setup:'||(select id from setup_fixture)) then raise exception 'Cross-owner leak';end if;end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',clerk_user_id)::text,true) from public.users where role='admin' limit 1;
update public.properties set active=false where id=(select id from setup_fixture);
do $$begin if exists(select 1 from private.inbox_items() where id='property:setup:'||(select id from setup_fixture)) then raise exception 'Inactive reminder retained';end if;end$$;
update public.properties set active=true,cleaning_config=jsonb_build_object('version',1,'rooms','[]'::jsonb,'supplies','[]'::jsonb) where id=(select id from setup_fixture);
do $$begin if exists(select 1 from private.inbox_items() where id='property:setup:'||(select id from setup_fixture)) then raise exception 'Resolved reminder retained';end if;end$$;
