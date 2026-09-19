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
 const html=renderToStaticMarkup(<OwnerCreateListing open listings={[]} onClose={()=>{}} onCreated={()=>{}} onChanged={()=>{}}/>);
 assert.match(html,/<dialog/);assert.match(html,/Listing name/);assert.match(html,/Address \/ unit/);assert.match(html,/America\/Detroit/);assert.match(html,/Bedrooms/);assert.match(html,/Bathrooms/);assert.equal((html.match(/class="owner-room-count-card"/g)||[]).length,2);assert.match(html,/aria-label="Decrease bedrooms" disabled/);assert.match(html,/aria-label="Increase bathrooms"/);
 assert.doesNotMatch(html,/ownerId|soloRate|payout|Cleaner pay|Select owner/);
});

test('Listings empty state retains the add action',()=>{
 const html=renderToStaticMarkup(<OwnerListings listings={[]} integration={{}} onChanged={()=>{}} from="2026-09-01" toExclusive="2026-10-01" revision={0} addListingAction={<OwnerAddListingButton role="owner" onClick={()=>{}}/>}/>);
 assert.match(html,/<h2>Listings<\/h2><button[^>]*>\+ Add listing<\/button>/);assert.match(html,/No properties yet/);
});
