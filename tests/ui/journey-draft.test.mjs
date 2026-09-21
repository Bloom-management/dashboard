import test from 'node:test';
import assert from 'node:assert/strict';
import {completionInput,uncertainCompletion} from '../../src/components/bloom/journey-draft.ts';
test('unanswered supplies default to full while explicit levels are preserved',()=>{
 assert.deepEqual(completionInput(2,['soap','paper'],{soap:'low'},'').answers,[{supplyId:'soap',level:'low'},{supplyId:'paper',level:'full'}]);
 assert.deepEqual(completionInput(2,['soap'],{soap:'not_found'},'Missing'),{configVersion:2,answers:[{supplyId:'soap',level:'not_found'}],notes:'Missing'});
 assert.deepEqual(completionInput(2,[],{},''),{configVersion:2,answers:[],notes:''});
 assert.equal(completionInput(2,['soap'],{soap:'unknown'},''),null);
});
test('serialized draft preserves immutable payload and idempotency key across back/retry',()=>{
 const draft={step:'supplies',answers:{soap:'low'},notes:'Refill',version:3,pending:{key:'same-key',input:completionInput(3,['soap'],{soap:'low'},'Refill')}};
 const restored=JSON.parse(JSON.stringify({...draft,step:'photos'}));
 assert.deepEqual(restored.pending,draft.pending);
 assert.equal(uncertainCompletion('NETWORK_ERROR'),true);
 assert.equal(uncertainCompletion('SOURCE_UNAVAILABLE'),true);
 assert.equal(uncertainCompletion('CONFIGURATION_ERROR'),true);
 assert.equal(uncertainCompletion('PHOTO_COVERAGE_REQUIRED'),false);
 assert.equal(uncertainCompletion('REVIEW_REQUIRED'),false);
});
test('maintenance defaults missing categories and requires a note for attention, preserving replay payload',()=>{
 const categories=['painting','fridge','electricity','wifi','tv','garage','climate','water'];
 const answers=Object.fromEntries(categories.map(category=>[category,{category,status:'ok',notes:''}]));
 assert.equal(completionInput(1,[],{},'',{}).maintenance.filter(a=>a.status==='not_applicable').length,8);
 answers.water={category:'water',status:'attention',notes:''};
 assert.equal(completionInput(1,[],{},'',answers),null);
 answers.water.notes='Tap leaks';
 const input=completionInput(1,[],{},'',answers);assert.equal(input.maintenance.length,8);
 assert.equal(input.maintenance.at(-1).notes,'Tap leaks');
 assert.deepEqual(JSON.parse(JSON.stringify({step:'maintenance',pending:{key:'stable',input}})).pending.input,input);
});
