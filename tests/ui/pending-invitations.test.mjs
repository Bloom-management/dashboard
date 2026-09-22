import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingPeople,resendRole} from '../../src/server/auth/pending-invitations.ts';
const invite=(id,status='pending',createdAt=1)=>({id,status,createdAt,emailAddress:'person@example.com',publicMetadata:{bloomInvite:{email:'person@example.com',actor:'admin',key:'receipt',role:'cleaner'}}});
test('pending people deduplicate resends and exclude accepted and revoked invitations',()=>{
 const result=pendingPeople([invite('old'),invite('new','pending',2),{...invite('accepted','accepted'),emailAddress:'accepted@example.com'},invite('revoked','revoked')]);assert.equal(result.length,1);assert.equal(result[0].id,'new');assert.equal(result[0].role,'cleaner');assert.equal('publicMetadata' in result[0],false);
});
test('resend only preserves a validated original role on a pending invitation',()=>{
 assert.equal(resendRole(invite('valid')),'cleaner');assert.throws(()=>resendRole(invite('accepted','accepted')),/INVALID_STATE/);assert.throws(()=>resendRole({...invite('invalid'),emailAddress:'different@example.com'}),/INVALID_STATE/);assert.throws(()=>resendRole({...invite('no-role'),publicMetadata:null}),/INVALID_STATE/);
});
