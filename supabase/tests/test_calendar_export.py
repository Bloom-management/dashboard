"""Real local PostgreSQL with simulated JWT claims, not a live Airbnb round trip.
Isolated UUID fixtures; no global truncation or destructive cleanup.
"""
import hashlib
import json
import unittest
import uuid
from test_database import sql, scalar, make_user, CITY
from test_calendar_database import rpc, data, source, event, sync


class CalendarExportTests(unittest.TestCase):
    def setUp(self):
        self.owner, self.owner_id = make_user('owner')
        self.other, _ = make_user('owner')
        self.admin, self.admin_id = make_user('admin')
        self.cleaner, _ = make_user('cleaner')
        self.prop = scalar(f"insert into public.properties(city_id,name,address,timezone,cleaning_management,private_payer_id,private_total_cents) values('{CITY}','Export fixture {uuid.uuid4().hex}','Synthetic address','America/Detroit','private','{self.owner_id}',9000) returning id;")
        sql(f"insert into public.property_owners(property_id,owner_id) values('{self.prop}','{self.owner_id}');")

    def settings(self, action='status', subject=None, key=None, ok=True):
        return rpc('bloom_calendar_export_settings', dict(p_property=self.prop, p_action=action, p_key=key or uuid.uuid4().hex), ok, subject or self.owner, 'authenticated')

    def feed(self, token, ok=True, subject='server', role='service_role'):
        digest = hashlib.sha256(token.encode()).hexdigest()
        return rpc('bloom_calendar_export_feed', dict(p_token_hash=digest), ok, subject, role)

    def action(self, action, payload, key=None):
        return data(rpc('bloom_property_calendar_action', dict(p_property=self.prop, p_action=action, p_data=payload, p_key=key or uuid.uuid4().hex), subject=self.owner, role='authenticated'))

    def reviewed(self, action, payload, key=None):
        preview = self.action('preview', payload)
        self.assertTrue(preview['ok'])
        return self.action(action, {**payload, 'reviewToken': preview['preview']['reviewToken']}, key)

    def booking(self):
        result = self.reviewed('create_booking', {'checkIn': '2032-03-12', 'checkout': '2032-03-15', 'note': 'PRIVATE INTERNAL NOTE'})
        self.assertTrue(result['ok'], result)
        return result

    def test_export_owner_isolation_admin_access_and_service_feed_boundary(self):
        for subject in [self.other, self.cleaner]:
            denied = self.settings(subject=subject, ok=False)
            self.assertNotEqual(denied.returncode, 0)
        enabled = data(self.settings('create'))
        self.assertTrue(enabled['enabled'])
        self.assertEqual(data(self.settings(subject=self.admin))['token'], enabled['token'])
        for role in ['anon', 'authenticated']:
            denied = self.feed(enabled['token'], False, self.owner, role)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('permission denied', denied.stderr)
        self.assertEqual(data(self.feed(enabled['token']))['events'], [])
        status = data(self.settings())
        self.assertIsNotNone(status['lastFetchedAt'])
        self.assertIsNone(status['ownerConfirmedAt'], 'A fetch does not prove Airbnb applied dates')

    def test_persistent_link_regeneration_revokes_old_capability(self):
        first = data(self.settings('create'))
        self.assertEqual(data(self.settings())['token'], first['token'])
        key = uuid.uuid4().hex
        rotated = data(self.settings('regenerate', key=key))
        self.assertNotEqual(rotated['token'], first['token'])
        self.assertEqual(data(self.settings('regenerate', key=key)), rotated)
        old = self.feed(first['token'], ok=False)
        self.assertEqual(old.returncode, 0)
        self.assertIn(old.stdout.strip(), ['', 'null'])
        self.assertEqual(data(self.feed(rotated['token']))['events'], [])
        self.settings('disable')
        self.assertIn(self.feed(rotated['token']).stdout.strip(), ['', 'null'])

    def test_manual_booking_feed_identity_privacy_edit_and_cancel(self):
        token = data(self.settings('create'))['token']
        booking = self.booking()
        original = data(self.feed(token))['events']
        self.assertEqual(len(original), 1)
        calendar_args = dict(p_from='2032-03-01', p_to='2032-03-31')
        own = data(rpc('bloom_manual_calendar', calendar_args, subject=self.owner, role='authenticated'))
        self.assertEqual([item['id'] for item in own], [booking['bookingId']])
        self.assertEqual(data(rpc('bloom_manual_calendar', calendar_args, subject=self.other, role='authenticated')), [])
        denied = rpc('bloom_manual_calendar', calendar_args, False, self.cleaner, 'authenticated')
        self.assertNotEqual(denied.returncode, 0)
        admins = data(rpc('bloom_manual_calendar', calendar_args, subject=self.admin, role='authenticated'))
        self.assertIn(booking['bookingId'], [item['id'] for item in admins])
        self.assertEqual(original[0]['id'], booking['bookingId'])
        self.assertEqual(original[0]['checkIn'], '2032-03-12')
        self.assertEqual(original[0]['checkout'], '2032-03-15')
        self.assertEqual(set(original[0]), {'id', 'checkIn', 'checkout', 'updatedAt', 'sequence'})
        self.assertNotIn('PRIVATE INTERNAL NOTE', json.dumps(original))
        edited = self.reviewed('edit_booking', {'bookingId': booking['bookingId'], 'bookingVersion': booking['version'], 'checkIn': '2032-03-12', 'checkout': '2032-03-16', 'reason': 'Fixture extension'})
        self.assertTrue(edited['ok'], edited)
        current = data(self.feed(token))['events'][0]
        self.assertEqual(current['id'], original[0]['id'])
        self.assertEqual(current['checkout'], '2032-03-16')
        self.assertGreater(current['sequence'], original[0]['sequence'])
        self.assertEqual(scalar(f"select count(*) from public.jobs where manual_booking_id='{booking['bookingId']}';"), '1')
        canceled = self.action('cancel_booking', {'bookingId': booking['bookingId'], 'bookingVersion': edited['version'], 'reason': 'Fixture cancellation'})
        self.assertTrue(canceled['ok'], canceled)
        self.assertEqual(data(self.feed(token))['events'], [])
        self.assertEqual(scalar(f"select status from public.jobs where id='{booking['jobId']}';"), 'cancelled')

    def test_cancelled_manual_booking_does_not_create_phantom_turnover_from_known_echo(self):
        booking = self.booking()
        actor, _, sid, _ = source(self.admin_id, self.prop)
        returned = event(uid='known-echo-'+uuid.uuid4().hex, start='2032-03-12', end='2032-03-15', kind='blocked', evidence='unverified', reviewRequired=True)
        sync(actor, sid, [returned])
        canceled = self.action('cancel_booking', {'bookingId': booking['bookingId'], 'bookingVersion': booking['version'], 'reason': 'Cancel pending provider refresh'})
        self.assertTrue(canceled['ok'], canceled)
        # Even if a subsequent source snapshot calls the existing echo a reservation,
        # known return provenance must prevent an unrelated replacement turnover.
        changed = event(uid=returned['uid'], start='2032-03-12', end='2032-03-15')
        sync(actor, sid, [changed]); sync(actor, sid, [changed])
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{self.prop}';"), '1')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{self.prop}' and status<>'cancelled';"), '0')

    def test_returned_airbnb_block_preserves_provenance_without_duplicate_cleaning(self):
        token = data(self.settings('create'))['token']
        booking = self.booking()
        actor, _, sid, _ = source(self.admin_id, self.prop)
        returned = event(uid='airbnb-rewritten-'+uuid.uuid4().hex, start='2032-03-12', end='2032-03-15', kind='blocked', evidence='unverified', reviewRequired=True)
        sync(actor, sid, [returned]); sync(actor, sid, [returned])
        self.assertEqual(scalar(f"select count(*) from private.manual_bookings where property_id='{self.prop}';"), '1')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{self.prop}';"), '1')
        self.assertEqual(scalar(f"select count(*) from public.calendar_events where source_id='{sid}';"), '1')
        self.assertEqual(scalar(f"select state from private.calendar_returns where booking_id='{booking['bookingId']}';"), 'ambiguous')
        self.assertEqual(len(data(self.feed(token))['events']), 1)
        admin_projection = data(rpc('bloom_admin_property_calendar_events', dict(p_property=self.prop), subject=self.admin, role='authenticated'))
        self.assertEqual(admin_projection['items'][0]['manualReturn'], 'ambiguous')
        projection = data(rpc('bloom_owner_analytics', dict(p_from='2032-03-12', p_to_exclusive='2032-03-16'), subject=self.owner, role='authenticated'))
        # SQL preserves both identities. Production TS metrics union their nights,
        # already verified by tests/calendar/owner-metrics.test.ts.
        manual = [e for e in projection['events'] if e['origin'] == 'manual']
        self.assertEqual(len(manual), 1)
        self.assertEqual(manual[0]['id'], booking['bookingId'])
        nights = set()
        import datetime
        for e in projection['events']:
            if e['removed'] or not (e['kind'] == 'blocked' or (e['kind'] == 'reservation' and e['confirmed'])):
                continue
            day = datetime.date.fromisoformat(e['startDate'])
            end = datetime.date.fromisoformat(e['endDate'])
            while day < end:
                nights.add(day); day += datetime.timedelta(days=1)
        self.assertEqual(len(nights), 3)
        sync(actor, sid, [event(uid='separate-imported-stay', start='2032-04-01', end='2032-04-03')])
        self.assertEqual(len(data(self.feed(token))['events']), 1, 'Imported reservations must not be republished')
        sync(actor, sid, [])
        self.assertEqual(len(data(self.feed(token))['events']), 1, 'Source omission must not delete a manual booking')


if __name__ == '__main__':
    unittest.main()
