import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingRoleTiles } from '../../src/components/bloom/onboarding-role-tiles';
import { LocationDropdown } from '../../src/components/bloom/location-dropdown';
import { OwnerCreateListing } from '../../src/components/bloom/owner-create';
test('public role tiles offer cleaner or owner with accessible selected radios, never admin',()=>{
 const html=renderToStaticMarkup(<OnboardingRoleTiles role="owner" onChange={()=>{}} disabled={false}/>);
 assert.equal((html.match(/type="radio"/g)||[]).length,2);assert.match(html,/Cleaner/);assert.match(html,/Owner/);assert.match(html,/checked=""/);assert.match(html,/Selected/);assert.doesNotMatch(html,/Admin|admin/);
 const locked=renderToStaticMarkup(<OnboardingRoleTiles role="owner" onChange={()=>{}} disabled/>);
 assert.match(locked,/<fieldset[^>]*disabled/);
});
test('existing listing setup embeds without creating a nested native dialog',()=>{
 const props={open:true,listings:[],onClose:()=>{},onCreated:()=>{},onChanged:()=>{}};
 const embedded=renderToStaticMarkup(<OwnerCreateListing {...props} embedded/>);
 assert.doesNotMatch(embedded,/<dialog/);assert.match(embedded,/Do this later/);assert.match(embedded,/Listing name/);assert.match(embedded,/Address \/ unit/);assert.match(embedded,/Rooms/);assert.match(embedded,/Supplies/);assert.match(embedded,/Calendar links/);
 const standalone=renderToStaticMarkup(<OwnerCreateListing {...props}/>);
 assert.equal((standalone.match(/<dialog/g)||[]).length,1);assert.doesNotMatch(standalone,/Do this later/);
});

test('cleaner city validation is attached to the actual dropdown trigger',()=>{
 const html=renderToStaticMarkup(<LocationDropdown locations={[{id:'city',name:'Detroit'}]} value="" onValueChange={()=>{}} label="Which city will you clean in?" ariaInvalid describedBy="city-help city-error"/>);
 assert.match(html,/aria-invalid="true"/);assert.match(html,/aria-describedby="city-help city-error"/);assert.match(html,/Which city will you clean in/);
});
