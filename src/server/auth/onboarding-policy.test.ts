import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardingPolicy, type Invite, type Profile } from './onboarding-policy';
const email='onboarding@example.invalid';
const evidence={pendingOwnerCount:0,propertyInvitations:[]};
const invite=(role='cleaner',status='pending'):Invite=>({id:'inv_1',emailAddress:email,status,publicMetadata:{bloomInvite:{role,email,key:'safe-key',actor:'admin-id'}}});
const state=(invites:Invite[],metadata:Record<string,unknown>={},profile:Profile|null=null)=>onboardingPolicy(profile,'Person',[email],metadata,invites,evidence);
test('new accounts choose; trusted pending or accepted invites lock role',()=>{
 assert.equal(state([]).status,'choose_role');
 for(const status of ['pending','accepted'])assert.deepEqual(state([invite('owner',status)]),{status:'setup',displayName:'Person',role:'owner',invited:true,cityId:null,homeBase:null,assignedPropertyCount:0});
});
test('revoked or expired invites without user metadata block fallback',()=>{
 for(const status of ['revoked','expired'])assert.equal((state([invite('cleaner',status)]) as {reason:string}).reason,status);
 assert.equal((state([invite('owner'),{...invite('cleaner'),id:'inv_2'}]) as {reason:string}).reason,'conflicting');
 assert.equal((state([],{bloomInvite:{email:'other@example.invalid'}}) as {reason:string}).reason,'mismatched');
});
test('complete existing account ignores old invitations; partial account retains mapped role',()=>{
 const profile:Profile={id:'id',role:'owner',displayName:'Owner',cityId:null,homeBase:null,complete:true,assignedPropertyCount:0};
 assert.deepEqual(state([invite('cleaner','revoked')],{},profile),{status:'complete',role:'owner',destination:'/owner'});
 assert.equal((state([invite('cleaner')],{},{...profile,complete:false}) as {reason:string}).reason,'conflicting');
});
test('pending owner evidence needs no fabricated listing; property sharing stays explicit',()=>{
 assert.deepEqual(onboardingPolicy(null,'Person',[email],{},[],{pendingOwnerCount:2,propertyInvitations:[]}),{status:'setup',displayName:'Person',role:'owner',invited:true,cityId:null,homeBase:null,assignedPropertyCount:2});
 const invitation={id:'property-inv',emailAddress:email,status:'pending',publicMetadata:{bloomPropertyInvite:'property-id'}};
 assert.equal(onboardingPolicy(null,'Person',[email],{},[invitation],{pendingOwnerCount:0,propertyInvitations:[{id:'property-id',status:'expired'}]}).status,'blocked');
});
test('admin provisioning can only follow actual trusted admin invite evidence',()=>{
 assert.deepEqual(state([invite('admin')]),{status:'complete',role:'admin',destination:'/admin'});
 assert.equal(state([],{bloomInvite:{role:'admin',email,key:'safe-key',actor:'admin-id'}}).status,'blocked');
});

test('local invalid invitation cannot fall through and revoked marker cannot borrow unrelated invite',()=>{
 assert.equal(onboardingPolicy(null,'Person',[email],{},[],{pendingOwnerCount:0,propertyInvitations:[{id:'p',status:'expired'}]}).status,'blocked');
 const revoked=invite('owner','revoked');
 const active={...invite('cleaner'),id:'different'};
 assert.equal((state([revoked,active],{bloomInvite:revoked.publicMetadata!.bloomInvite}) as {reason:string}).reason,'revoked');
});
