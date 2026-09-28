import test from 'node:test';
import assert from 'node:assert/strict';
import {profileName} from '../../src/server/auth/profile-name';
test('profile names reject placeholders and unsafe or empty values',()=>{
 for(const value of [null,undefined,'','  ','Account',' account ','A\u0000B','A\u202eB','x'.repeat(101)])assert.equal(profileName(value),null);
});
test('profile names preserve international names and mononyms',()=>{
 assert.equal(profileName('  Pierre   Harbin  '),'Pierre Harbin');
 assert.equal(profileName('李'),'李');assert.equal(profileName('Óscar de la Cruz'),'Óscar de la Cruz');
});
