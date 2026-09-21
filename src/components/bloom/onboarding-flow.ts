import type { CompleteOnboardingInput,OnboardingRole,OnboardingState } from '../../contracts/onboarding';
export function onboardingInput(role:OnboardingRole|null,cityId:string,homeBase:string):CompleteOnboardingInput|null {
 if(role==='cleaner')return cityId?{role,cityId}:null;
 if(role==='owner'){const city=homeBase.trim();return city&&city.length<=100?{role,homeBase:city}:null;}
 return null;
}
export function onboardingMayHaveSucceeded(code?:string){return !['VALIDATION_ERROR','FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','CONFLICT','INVALID_STATE'].includes(code??'');}
export function onboardingHeading(state:OnboardingState,role:OnboardingRole|null,roleStep:boolean){
 if(state.status==='blocked')return 'Your account needs attention';
 if(state.status==='complete')return 'Your Bloom workspace is ready.';
 if(roleStep)return 'Find your place in Bloom.';
 const resolved=state.status==='setup'?state.role:role;
 const article=resolved==='owner'?'an owner':'a cleaner';
 return state.status==='setup'&&state.invited?`Congrats! You've been invited to be ${article}.`:`Welcome to Bloom! Let’s get you started as ${article}.`;
}
