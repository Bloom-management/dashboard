import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnerAddListingButton,OwnerCreateListing } from '../../src/components/bloom/owner-create';
import { OwnerListings } from '../../src/components/bloom/owner-listings';
test('owner add listing opens a modal action; admin uses existing admin property flow',()=>{
 const admin=renderToStaticMarkup(<OwnerAddListingButton role="admin" onClick={()=>{}}/>);
 assert.match(admin,/href="\/admin\?view=properties&amp;new=1"/);
 const owner=renderToStaticMarkup(<OwnerAddListingButton role="owner" onClick={()=>{}}/>);
 assert.match(owner,/<button/);assert.match(owner,/Add listing/);assert.doesNotMatch(owner,/href=/);
 assert.equal(renderToStaticMarkup(<OwnerAddListingButton role="cleaner" onClick={()=>{}}/>),'');
});
test('creation dialog has property fields, zero-to-twenty counts and no financial or owner selector',()=>{
 const first=renderToStaticMarkup(<OwnerCreateListing open listings={[]} onClose={()=>{}} onCreated={()=>{}} onChanged={()=>{}}/>);
 // Step 1 holds only the optional Airbnb import and the address.
 assert.match(first,/<dialog/);assert.match(first,/Step 1 of 7/);assert.match(first,/Import Airbnb listing \(optional\)/);assert.match(first,/Street address/);assert.match(first,/Apartment \/ unit/);assert.doesNotMatch(first,/Listing name|Bedrooms|Calendar links/);
 // Step 2 is only the listing type choice.
 const type=renderToStaticMarkup(<OwnerCreateListing open initialPage={1} listings={[]} onClose={()=>{}} onCreated={()=>{}} onChanged={()=>{}}/>);
 assert.match(type,/Step 2 of 7 · Listing type/);assert.match(type,/Back to import and address/);assert.equal((type.match(/class="owner-listing-type-card"/g)||[]).length,2);assert.match(type,/Entire unit/);assert.match(type,/Room</);assert.doesNotMatch(type,/Listing name|Bedrooms|Supply|Calendar links|Save listing/);
 const html=renderToStaticMarkup(<OwnerCreateListing open initialPage={2} listings={[]} onClose={()=>{}} onCreated={()=>{}} onChanged={()=>{}}/>);
 assert.match(html,/Step 3 of 7 · Rooms/);assert.match(html,/Back to listing type/);assert.match(html,/Listing name/);assert.match(html,/<div hidden=""><fieldset[^>]*><section[^>]*aria-label="Import from Airbnb"[\s\S]*Street address/);assert.doesNotMatch(html,/Find on map|Choose city|Property timezone|Calendar links/);assert.match(html,/Bedrooms/);assert.match(html,/Bathrooms/);assert.equal((html.match(/class="owner-room-count-card"/g)||[]).length,2);assert.match(html,/aria-label="Decrease bedrooms" disabled/);assert.match(html,/aria-label="Increase bathrooms"/);
 const calendar=renderToStaticMarkup(<OwnerCreateListing open initialPage={6} listings={[]} onClose={()=>{}} onCreated={()=>{}} onChanged={()=>{}}/>);
 assert.match(calendar,/Step 7 of 7 · Calendar/);assert.match(calendar,/Back to access/);assert.match(calendar,/Calendar links \(optional\)/);assert.match(calendar,/Private Airbnb iCal export link/);assert.match(calendar,/Private Vrbo iCal export link/);assert.match(calendar,/Save listing/);assert.doesNotMatch(calendar,/Listing name|Bedrooms/);
 assert.doesNotMatch(html,/ownerId|soloRate|payout|Cleaner pay|Select owner/);
});

test('Listings empty state retains the add action',()=>{
 const html=renderToStaticMarkup(<OwnerListings listings={[]} integration={{}} onChanged={()=>{}} from="2026-09-01" toExclusive="2026-10-01" revision={0} addListingAction={<OwnerAddListingButton role="owner" onClick={()=>{}}/>}/>);
 assert.match(html,/<h2>Listings<\/h2><button[^>]*>\+ Add listing<\/button>/);assert.match(html,/No properties yet/);
});
