-- Metro Detroit (Wayne, Oakland and Macomb counties) is one Bloom service city.
-- New registrations are mapped to Detroit by the server (serviceArea in src/server/locations/cities.ts).
-- This moves cities registered before that change, matched by municipality name, into Detroit.
begin;
create temporary table metro_detroit_localities(name text primary key) on commit drop;
insert into metro_detroit_localities(name) values
 -- Wayne County
 ('allen park'),('belleville'),('brownstown'),('canton'),('dearborn'),('dearborn heights'),('ecorse'),('flat rock'),
 ('garden city'),('gibraltar'),('grosse ile'),('grosse pointe'),('grosse pointe farms'),('grosse pointe park'),
 ('grosse pointe shores'),('grosse pointe woods'),('hamtramck'),('harper woods'),('highland park'),('huron'),('inkster'),
 ('lincoln park'),('livonia'),('melvindale'),('northville'),('plymouth'),('redford'),('river rouge'),('riverview'),
 ('rockwood'),('romulus'),('southgate'),('sumpter'),('taylor'),('trenton'),('van buren'),('wayne'),('westland'),
 ('woodhaven'),('wyandotte'),
 -- Oakland County
 ('addison'),('auburn hills'),('berkley'),('beverly hills'),('bingham farms'),('birmingham'),('bloomfield'),
 ('bloomfield hills'),('brandon'),('clarkston'),('clawson'),('commerce'),('farmington'),('farmington hills'),('ferndale'),
 ('franklin'),('groveland'),('hazel park'),('highland'),('holly'),('huntington woods'),('independence'),('keego harbor'),
 ('lake angelus'),('lake orion'),('lathrup village'),('leonard'),('lyon'),('madison heights'),('milford'),('novi'),
 ('oak park'),('oakland'),('orchard lake'),('orchard lake village'),('orion'),('ortonville'),('oxford'),('pleasant ridge'),
 ('pontiac'),('rochester'),('rochester hills'),('rose'),('royal oak'),('south lyon'),('southfield'),('springfield'),
 ('sylvan lake'),('troy'),('walled lake'),('waterford'),('west bloomfield'),('white lake'),('wixom'),('wolverine lake'),
 -- Macomb County
 ('armada'),('bruce'),('center line'),('chesterfield'),('clinton'),('eastpointe'),('fraser'),('harrison'),('lenox'),
 ('macomb'),('memphis'),('mount clemens'),('new baltimore'),('new haven'),('ray'),('richmond'),('romeo'),('roseville'),
 ('saint clair shores'),('st. clair shores'),('st clair shores'),('shelby'),('sterling heights'),('utica'),('warren'),
 ('washington');

create temporary table metro_detroit_merge on commit drop as
 select c.id from public.cities c
 where c.id<>'00000000-0000-4000-8000-000000000001' and lower(c.region)='michigan' and c.country_code='US'
  and regexp_replace(lower(trim(c.locality_name)),'\s+(charter\s+)?township$','') in (select name from metro_detroit_localities);

update public.properties set city_id='00000000-0000-4000-8000-000000000001' where city_id in (select id from metro_detroit_merge);
update public.users set approved_city_id='00000000-0000-4000-8000-000000000001' where approved_city_id in (select id from metro_detroit_merge);
update public.city_change_requests set requested_city_id='00000000-0000-4000-8000-000000000001' where requested_city_id in (select id from metro_detroit_merge);
update private.bloom_pool_requests set requested_city_id='00000000-0000-4000-8000-000000000001' where requested_city_id in (select id from metro_detroit_merge);
-- Keep the merged rows for history (push records still reference them) but hide them from city lists.
update public.cities set active=false,cleaning_coverage='unavailable' where id in (select id from metro_detroit_merge);
commit;
