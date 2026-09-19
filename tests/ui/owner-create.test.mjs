import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerCreateInput, ownerCreationMayHaveSucceeded, mergeCreatedListings, unconfirmedCreatedListings } from '../../src/components/bloom/owner-create-input.ts';
const draft={name:' LOCAL TEST unit ',address:' Synthetic test address ',cityId:'local-city',timezone:'America/Detroit',bedroomCount:'0',bathroomCount:'20'};
test('owner creation accepts zero and twenty rooms without sending roles, ownership or pay',()=>{
 const result=ownerCreateInput({...draft,ownerId:'never-send',soloRateCents:7500,isBloomOwned:true});
 assert.deepEqual(result,{name:'LOCAL TEST unit',address:'Synthetic test address',cityId:'local-city',timezone:'America/Detroit',bedroomCount:0,bathroomCount:20});
});
test('owner creation rejects invalid counts and incomplete property details',()=>{
 for(const value of ['','-1','21','1.5','1e1','NaN'])assert.equal(ownerCreateInput({...draft,bedroomCount:value}),null);
 for(const change of [{name:' '},{name:'x'.repeat(201)},{address:''},{address:'x'.repeat(501)},{cityId:''},{timezone:'No/SuchZone'}])assert.equal(ownerCreateInput({...draft,...change}),null);
});

test('definitive rejections unlock corrections while uncertain outcomes retain the receipt',()=>{
 for(const code of ['VALIDATION_ERROR','FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','CONFLICT','INVALID_STATE'])assert.equal(ownerCreationMayHaveSucceeded(code),false,code);
 for(const code of ['NETWORK_ERROR','SOURCE_UNAVAILABLE','SERVICE_UNAVAILABLE','CONFIGURATION_ERROR',undefined,'UNEXPECTED_ERROR'])assert.equal(ownerCreationMayHaveSucceeded(code),true,String(code));
});

test('successful creation appears before reload, deduplicates, and cannot revive a confirmed deleted unit',()=>{
 const created={id:'created',name:'Just saved',sources:[]};
 assert.deepEqual(mergeCreatedListings([], [created]),[created]);
 const refreshed={...created,name:'Fresh server name',sources:[{id:'new-source'}]};
 assert.deepEqual(mergeCreatedListings([refreshed],[created]),[refreshed]);
 const pending=unconfirmedCreatedListings([refreshed],[created]);
 assert.deepEqual(pending,[]);
 assert.deepEqual(mergeCreatedListings([],pending),[]);
});
