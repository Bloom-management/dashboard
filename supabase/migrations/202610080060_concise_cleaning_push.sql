begin;
-- Keep existing eligibility/completion rules; only shorten eligible new-job copy.
alter function private.push_content(uuid,timestamptz) rename to push_content_before_concise;
create function private.push_content(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare content jsonb;m private.push_messages;unit_name text;day date;n integer;begin
 content:=private.push_content_before_concise(p_message,p_now);
 if content is null then return null;end if;
 select * into m from private.push_messages where id=p_message;
 if m.kind<>'new' then return content;end if;
 select p.name,j.checkout_date into unit_name,day from public.jobs j join public.properties p on p.id=j.property_id
 where j.id=any(m.job_ids) and private.push_claimable(j.id,p_now)
 and not exists(select 1 from public.assignments a where a.job_id=j.id and a.cleaner_id=m.user_id and a.ended_at is null)
 order by j.checkout_date,j.id limit 1;
 if day is null then return null;end if;
 n:=(content->>'count')::integer;
 return jsonb_set(content,'{body}',to_jsonb('New cleaning: '||left(unit_name,80)||' · '||to_char(day,'Mon FMDD')||case when n>1 then ' (+'||(n-1)||' more)' else '' end));
end $$;
revoke all on function private.push_content(uuid,timestamptz),private.push_content_before_concise(uuid,timestamptz) from public,anon,authenticated,service_role;
commit;
