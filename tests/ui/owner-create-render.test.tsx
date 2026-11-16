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
 assert.match(first,/<dialog/);assert.match(first,/Step 1 of 2/);assert.match(first,/Import Airbnb listing \(optional\)/);assert.match(first,/Street address/);assert.match(first,/Apartment \/ unit/);assert.doesNotMatch(first,/Listing name|Bedrooms|Calendar links/);
 const html=renderToStaticMarkup(<OwnerCreateListing open initialPage={1} listings={[]} onClose={()=>{}} onCreated={()=>{}} onChanged={()=>{}}/>);
 assert.match(html,/Step 2 of 2/);assert.match(html,/Back to import and address/);assert.match(html,/Listing name/);assert.match(html,/<div hidden=""><fieldset[^>]*><section[^>]*aria-label="Import from Airbnb"[\s\S]*Street address/);assert.doesNotMatch(html,/Find on map|Choose city|Property timezone/);assert.match(html,/Bedrooms/);assert.match(html,/Bathrooms/);assert.equal((html.match(/class="owner-room-count-card"/g)||[]).length,2);assert.match(html,/aria-label="Decrease bedrooms" disabled/);assert.match(html,/aria-label="Increase bathrooms"/);
 assert.match(html,/Calendar links \(optional\)/);assert.match(html,/Private Airbnb iCal export link/);assert.match(html,/Private Vrbo iCal export link/);
 assert.doesNotMatch(html,/ownerId|soloRate|payout|Cleaner pay|Select owner/);
});

test('Listings empty state retains the add action',()=>{
 const html=renderToStaticMarkup(<OwnerListings listings={[]} integration={{}} onChanged={()=>{}} from="2026-09-01" toExclusive="2026-10-01" revision={0} addListingAction={<OwnerAddListingButton role="owner" onClick={()=>{}}/>}/>);
 assert.match(html,/<h2>Listings<\/h2><button[^>]*>\+ Add listing<\/button>/);assert.match(html,/No properties yet/);
});
