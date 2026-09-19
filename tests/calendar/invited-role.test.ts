import test from 'node:test';
import assert from 'node:assert/strict';
import { invitedRole } from '../../src/server/auth/invited-role';
test('invited roles require verified matching email and server invitation stamp',()=>{
 for(const role of ['owner','cleaner','admin'] as const){
  const metadata={role,email:'person@example.com',key:'receipt',actor:'admin'};
  assert.equal(invitedRole(metadata,'PERSON@example.com',true),role);
  assert.equal(invitedRole(metadata,'other@example.com',true),null);
  assert.equal(invitedRole(metadata,'person@example.com',false),null);
 }
 assert.equal(invitedRole({role:'admin'},'person@example.com',true),null);
 assert.equal(invitedRole({role:'superadmin',email:'person@example.com',key:'key',actor:'admin'},'person@example.com',true),null);
});
