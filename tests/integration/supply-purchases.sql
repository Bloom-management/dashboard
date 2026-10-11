-- Local fixture acceptance. All purchases and restocks roll back; no external calls.
begin;
create temporary table purchase_fixture as select p.id,po.owner_id,(p.cleaning_config->'supplies'->0->>'id')::uuid supply_id,p.timezone from public.properties p join public.property_owners po on po.property_id=p.id where p.active and p.deleted_at is null and jsonb_array_length(p.cleaning_config->'supplies')>0 limit 1;
do $$begin if not exists(select 1 from purchase_fixture) then raise exception 'Need a local owner/property/supply fixture';end if;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',u.clerk_user_id)::text,true) from public.users u join purchase_fixture f on f.owner_id=u.id;
do $$declare f record;r jsonb;body jsonb;history jsonb;today date;begin
 select * into f from purchase_fixture;today:=(now() at time zone f.timezone)::date;
 body:=jsonb_build_object('productName','Test dish soap','productUrl','https://example.com/soap','imageUrl',null,'costCents',1299,'purchaseDate',today,'restockedDate',null);
 r:=public.bloom_supply_purchases(f.id,f.supply_id,body,'purchase-test');
 if public.bloom_supply_purchases(f.id,f.supply_id,body,'purchase-test')<>r then raise exception 'Retry changed receipt';end if;
 history:=public.bloom_supply_purchases(f.id,f.supply_id);
 if jsonb_array_length(history->'items')<>1 or history->'items'->0->>'costCents'<>'1299' or history->'items'->0->>'restockedDate' is not null then raise exception 'Wrong purchase history';end if;
 if (select restocked_at from private.supply_purchases where id=(r->>'id')::uuid) is not null then raise exception 'Purchase changed inventory';end if;
 perform public.bloom_supply_purchases(f.id,f.supply_id,jsonb_build_object('restockId',r->>'id','restockedDate',today),'restock-test');
 if (public.bloom_supply_purchases(f.id,f.supply_id)->'items'->0->>'restockedDate')::date<>today then raise exception 'Restock missing';end if;
 if not exists(select 1 from jsonb_array_elements(public.bloom_owner_listings()->'items') p cross join lateral jsonb_array_elements(p->'supplies') s where p->>'id'=f.id::text and s->>'supplyId'=f.supply_id::text and s->>'level'='full' and (s->>'lastRestockedDate')::date=today) then raise exception 'Listing not refreshed';end if;
 begin perform public.bloom_supply_purchases(f.id,f.supply_id,jsonb_set(body,'{costCents}','-10'),'invalid-cost');raise exception 'Negative cost accepted';exception when others then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
 begin perform public.bloom_supply_purchases(f.id,f.supply_id,jsonb_set(body,'{purchaseDate}',to_jsonb((today+1)::text)),'future-date');raise exception 'Future date accepted';exception when others then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
 begin perform public.bloom_supply_purchases(f.id,f.supply_id,jsonb_set(body,'{productUrl}','"javascript:alert(1)"'),'unsafe-link');raise exception 'Unsafe URL accepted';exception when others then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',clerk_user_id)::text,true) from public.users where role='admin' limit 1;
do $$declare f record;begin select * into f from purchase_fixture;if jsonb_array_length(public.bloom_supply_purchases(f.id,f.supply_id)->'items')<>1 then raise exception 'Admin cannot read';end if;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',u.clerk_user_id)::text,true) from public.users u where u.role='owner' and u.id<>(select owner_id from purchase_fixture) and not exists(select 1 from public.property_owners po where po.owner_id=u.id and po.property_id=(select id from purchase_fixture)) limit 1;
do $$declare f record;begin select * into f from purchase_fixture;begin perform public.bloom_supply_purchases(f.id,f.supply_id);raise exception 'Unrelated owner read history';exception when others then if sqlerrm<>'NOT_FOUND' then raise;end if;end;end $$;
rollback;
