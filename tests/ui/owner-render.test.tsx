import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnerTimeline } from '../../src/components/bloom/owner-timeline';
import { OwnerSupplySummary, OwnerSources } from '../../src/components/bloom/owner-listings';
import { OwnerTotals, OwnerPlatformShare } from '../../src/components/bloom/owner-performance';
import type { OwnerListing,OwnerMetricTotals } from '../../src/contracts/owner-hub';
const totals:OwnerMetricTotals={bookedNights:3,blockedNights:2,occupiedNights:5,unbookedNights:null,checkIns:1,occupancy:null,coverage:{status:'unknown',from:'2026-09-01',toExclusive:'2026-09-05',eligibleUnitNights:0,totalUnitNights:4,message:'Export horizon unknown.'},platformShare:[{platform:'airbnb',nights:3,share:.6},{platform:'unknown',nights:2,share:.4}]};
test('exactly one timeline row per selected unit even with no imported stays',()=>{
 const html=renderToStaticMarkup(<OwnerTimeline properties={[{id:'a',name:'Unit A'},{id:'b',name:'Unit B'}]} blocks={[]} from="2026-09-01" toExclusive="2026-10-01" onSelect={()=>{}}/>);
 assert.equal((html.match(/data-owner-unit=/g)||[]).length,2);assert.equal((html.match(/No stays reported/g)||[]).length,2);
});
test('incomplete coverage never renders false availability or percentage',()=>{
 const html=renderToStaticMarkup(<OwnerTotals totals={{...totals,occupancy:.99,unbookedNights:0}}/>);
 assert.match(html,/Occupancy including blocked nights<\/span><strong>N\/A/);assert.match(html,/Unbooked nights<\/span><strong>N\/A/);assert.match(html,/known observations/);assert.match(html,/Off-platform \/ unknown/);assert.match(html,/60%/);assert.doesNotMatch(html,/99%/);
});
test('listing supplies distinguish configuration from missing reports and exclude internal data',()=>{
 const listing:OwnerListing={id:'unit',name:'Local test',timezone:'America/Detroit',active:true,nightlyGuestRateCents:null,hostPayoutCents:null,currency:'USD',sources:[],supplies:[]};
 assert.match(renderToStaticMarkup(<OwnerSupplySummary listing={listing}/>),/No supplies are configured/);
 const withUnknownFields={...listing,cleanerName:'DO-NOT-RENDER',pay:7500,instructions:'SECRET',supplies:[{supplyId:'s',name:'Paper towels',level:null,reportedAt:null},{supplyId:'soap',name:'Soap',level:'low' as const,reportedAt:'2026-09-18T15:00:00Z'}]};
 const html=renderToStaticMarkup(<OwnerSupplySummary listing={withUnknownFields}/>);
 assert.match(html,/Default level · No cleaner report yet/);assert.match(html,/Low/);assert.match(html,/data-level="full"/);assert.match(html,/data-level="low"/);assert.match(html,/owner-supply-bar/);assert.doesNotMatch(html,/DO-NOT-RENDER|7500|SECRET/);
});

test('listing source controls offer Airbnb and Vrbo sync',()=>{
 const base={propertyId:'unit',enabled:true,lastSuccessAt:null,lastAttemptAt:null,message:null};
 const listing:OwnerListing={id:'unit',name:'Local test',timezone:'America/Detroit',active:true,nightlyGuestRateCents:null,hostPayoutCents:null,currency:'USD',supplies:[],sources:[{...base,id:'airbnb-source',provider:'airbnb'},{...base,id:'vrbo-source',provider:'vrbo'}]};
 const html=renderToStaticMarkup(<OwnerSources listing={listing} onChanged={()=>{}}/>);
 assert.match(html,/Vrbo/);assert.match(html,/Airbnb/);assert.equal((html.match(/Sync now<\/button>/g)||[]).length,2);assert.match(html,/public listing URL/);assert.match(html,/listing stays saved/);
 const share=renderToStaticMarkup(<OwnerPlatformShare totals={totals}/>);
 assert.match(share,/Share of known occupied nights/);assert.match(share,/not a measure of complete calendar coverage/);assert.match(share,/60%/);
});

test('same-day timeline marker is visible and names its zero-night duration',()=>{
 const html=renderToStaticMarkup(<OwnerTimeline properties={[{id:'a',name:'Unit A'}]} blocks={[{id:'same-day',propertyId:'a',propertyName:'Unit A',timezone:'America/Detroit',providers:['airbnb'],kind:'reservation',removed:false,changes:[],startDate:'2026-09-01',endDate:'2026-09-01'}]} from="2026-09-01" toExclusive="2026-10-01" onSelect={()=>{}}/>);
 assert.match(html,/same-day/);assert.match(html,/Same-day event, zero nights/);assert.match(html,/width:28px/);assert.doesNotMatch(html,/width:0%/);assert.doesNotMatch(html,/No stays reported/);
});


import {PropertyAvatarStack} from '../../src/components/bloom/property-people';
test('property avatars cap at two with accurate overflow and unchanged Bloom asset',()=>{
 const members=Array.from({length:5},(_,i)=>({id:String(i),displayName:`Owner ${i}`,imageUrl:`https://img.clerk.com/test-${i}`}));
 const html=renderToStaticMarkup(<PropertyAvatarStack bloomOwned={false} members={members}/>);
 assert.equal((html.match(/class="property-avatar"/g)||[]).length,2);assert.match(html,/>\+3</);assert.doesNotMatch(html,/alt="Owner 2"/);
 const bloom=renderToStaticMarkup(<PropertyAvatarStack bloomOwned members={members}/>);
 assert.match(bloom,/src="\/icon.svg"/);assert.match(bloom,/alt="Bloom"/);assert.doesNotMatch(bloom,/img.clerk.com/);
});
