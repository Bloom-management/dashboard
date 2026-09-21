import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingInput,onboardingHeading,onboardingMayHaveSucceeded } from '../../src/components/bloom/onboarding-flow.ts';
test('owner home base is free text and cleaner uses only a supported city identifier',()=>{
 assert.deepEqual(onboardingInput('owner','',' San Juan, PR '),{role:'owner',homeBase:'San Juan, PR'});
 assert.deepEqual(onboardingInput('cleaner','supported-city','ignored'),{role:'cleaner',cityId:'supported-city'});
 assert.equal(onboardingInput('owner','',' '),null);assert.equal(onboardingInput('owner','','x'.repeat(101)),null);
 assert.equal(onboardingInput('cleaner','','Detroit'),null);assert.equal(onboardingInput('admin','city','base'),null);
});
test('only trusted invited setup state receives congratulations and its role wins',()=>{
 const setup={status:'setup',displayName:'Test',role:'owner',invited:true,cityId:null,homeBase:null,assignedPropertyCount:1};
 assert.match(onboardingHeading(setup,'cleaner',false),/invited to be an owner/);
 assert.doesNotMatch(onboardingHeading({...setup,invited:false},'owner',false),/invited|Congrats/);
 assert.equal(onboardingHeading({status:'choose_role',displayName:'Test'},'owner',true),'Find your place in Bloom.');
 assert.equal(onboardingHeading({status:'blocked',reason:'revoked',message:'Cannot continue'},null,false),'Your account needs attention');
});
test('uncertain onboarding outcomes retain original atomic request while definitive errors permit correction',()=>{
 for(const code of [undefined,'NETWORK_ERROR','SOURCE_UNAVAILABLE','CONFIGURATION_ERROR'])assert.equal(onboardingMayHaveSucceeded(code),true);
 for(const code of ['VALIDATION_ERROR','FORBIDDEN','UNAUTHENTICATED','CONFLICT'])assert.equal(onboardingMayHaveSucceeded(code),false);
});
