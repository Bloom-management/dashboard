'use client';
import { DialogClose } from './dialog-close';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignOutButton,UserButton } from '@clerk/nextjs';
import type { CompleteOnboardingInput,CompleteOnboardingResult,OnboardingRole,OnboardingState } from '../../contracts/onboarding';
import type { OwnerListing,OwnerListingsPage } from '../../contracts/owner-hub';
import type { CityOption } from './integration';
import { ApiError,request } from './api';
import { Brand,ErrorNotice,Loading,useResource } from './primitives';
import { LocationDropdown } from './location-dropdown';
import { OnboardingRoleTiles } from './onboarding-role-tiles';
import { OwnerCreateListing } from './owner-create';
import { onboardingHeading,onboardingInput,onboardingMayHaveSucceeded } from './onboarding-flow';

export function Onboarding({initialState}:{initialState:OnboardingState}) {
 const router=useRouter();const [state,setState]=useState(initialState);const [role,setRole]=useState<OnboardingRole|null>(initialState.status==='setup'?initialState.role:null);
 const [stage,setStage]=useState<'role'|'setup'|'listing'>(initialState.status==='choose_role'?'role':'setup');const [open,setOpen]=useState(true);
 const [city,setCity]=useState(initialState.status==='setup'?initialState.cityId??'':'');const [homeBase,setHomeBase]=useState(initialState.status==='setup'?initialState.homeBase??'':'');
 const [addListing,setAddListing]=useState(false);const [listingStarted,setListingStarted]=useState(false);const [listings,setListings]=useState<OwnerListing[]>([]);const [listingTitle,setListingTitle]=useState('Add a listing');const [listingBusy,setListingBusy]=useState(false);
 const [listingsError,setListingsError]=useState<unknown>();const listingRead=useRef(0);
 const [busy,setBusy]=useState(false);const [uncertain,setUncertain]=useState(false);const [error,setError]=useState<unknown>();const [validation,setValidation]=useState('');
 const receipt=useRef<{input:CompleteOnboardingInput;key:string}|null>(null);const lock=useRef(false);const dialog=useRef<HTMLDialogElement>(null);const heading=useRef<HTMLHeadingElement>(null);const resume=useRef<HTMLButtonElement>(null);const titleId=useId();const introId=useId();
 const fieldInvalid=!!validation||(error instanceof ApiError&&error.code==='VALIDATION_ERROR');
 const activeRole=state.status==='setup'?state.role:role;const locked=busy||uncertain;
 const loadCities=useCallback((signal:AbortSignal)=>activeRole==='cleaner'&&stage==='setup'&&state.status!=='complete'?request<CityOption[]>('/cities',{signal}):Promise.resolve([]),[activeRole,stage,state.status]);const cities=useResource(loadCities);
 const close=()=>{if(busy||listingBusy)return;if(state.status==='complete')router.replace(state.destination);else setOpen(false);};
 useEffect(()=>{if(open){if(!dialog.current?.open)dialog.current?.showModal();heading.current?.focus();}else{dialog.current?.close();resume.current?.focus();}},[open]);
 useEffect(()=>{if(open)heading.current?.focus();},[stage,state.status,open]);
 useEffect(()=>()=>{dialog.current?.close();},[]);
 function complete(result:CompleteOnboardingResult){
  receipt.current=null;setUncertain(false);setState(result);setError(undefined);
  if(result.role==='owner'&&addListing){setListingStarted(true);setStage('listing');}
  else router.replace(result.destination);
 }
 async function refreshListings(){
  const version=++listingRead.current;setListingsError(undefined);
  try{const rows:OwnerListing[]=[];let cursor:string|null=null;const seen=new Set<string>();do{
   const page:OwnerListingsPage=await request<OwnerListingsPage>(`/owner/listings${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);rows.push(...page.items);cursor=page.nextCursor;if(cursor){if(seen.has(cursor))throw new Error('Listing pagination did not advance');seen.add(cursor);}
  }while(cursor);if(version===listingRead.current)setListings(rows);}
  catch(failure){if(version===listingRead.current)setListingsError(failure);}
 }
 async function refresh(){
  if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
  try{const next=await request<OnboardingState>('/onboarding');if(next.status==='complete'){complete(next);return;}setState(next);if(next.status==='choose_role'&&(state.status!=='choose_role'||!role))setStage('role');if(next.status==='setup'){setRole(next.role);setStage('setup');if(!receipt.current){setCity(next.cityId??city);setHomeBase(next.homeBase??homeBase);}}}
  catch(failure){setError(failure);}finally{lock.current=false;setBusy(false);}
 }
 async function save(event:React.FormEvent){
  event.preventDefault();if(lock.current)return;
  if(stage==='role'){if(role){setStage('setup');setValidation('');}else setValidation('Choose Cleaner or Owner to continue.');return;}
  const input=receipt.current?.input??onboardingInput(activeRole,city,homeBase);
  if(!input){setValidation(activeRole==='cleaner'?'Choose a supported city to continue.':'Enter the city you are based in to continue.');return;}
  if(!receipt.current)receipt.current={input,key:crypto.randomUUID()};lock.current=true;setBusy(true);setUncertain(true);setError(undefined);setValidation('');
  try{complete(await request<CompleteOnboardingResult>('/onboarding',{body:receipt.current.input,key:receipt.current.key}));}
  catch(failure){setError(failure);if(failure instanceof ApiError&&!onboardingMayHaveSucceeded(failure.code)){receipt.current=null;setUncertain(false);}}
  finally{lock.current=false;setBusy(false);}
 }
 const welcomePrefix=stage==='setup'&&(state.status==='setup'||state.status==='choose_role')?(state.status==='setup'&&state.invited?'Congrats!':'Welcome to Bloom!'):null;
 const title=stage==='listing'?listingTitle:onboardingHeading(state,activeRole,stage==='role');
 const intro=stage==='role'?'A fresh start begins with you. Choose how you’d like to get started.':activeRole==='cleaner'?'Let’s set up your home base. Your next fresh start is just around the corner.':'A warm welcome to your new home for hosting. Let’s get you settled in.';
 return <div className="bloom-owner app bloom-onboarding"><header className="topbar"><div className="onboarding-brand"><Brand role={activeRole??'owner'}/><span>Welcome</span></div><div className="topbar-right"><UserButton/></div></header><main className="onboarding-workspace"><h1>A fresh start with Bloom.</h1><p>{state.status==='complete'?'Your account is ready. Finish your listing setup or open your workspace.':'A little setup. Then you’re in.'}</p><button ref={resume} type="button" className="bloom-button" onClick={()=>setOpen(true)}>{listingStarted?'Resume listing setup':'Resume setup'}</button>{state.status==='complete'&&<button type="button" className="bloom-button secondary" onClick={()=>router.replace(state.destination)}>Open my workspace</button>}<SignOutButton redirectUrl="/sign-in"><button type="button" className="bloom-button secondary">Sign out</button></SignOutButton></main>
 <dialog ref={dialog} className={`onboarding-dialog ${stage==='listing'?'onboarding-listing-dialog':''}`} aria-labelledby={titleId} aria-describedby={stage==='listing'?undefined:introId} onCancel={event=>{event.preventDefault();close();}}>
 <DialogClose label="Close welcome and finish later" disabled={busy||listingBusy} onClose={close}/><div className="onboarding-dialog-inner"><div className="onboarding-modal-top"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/></svg>Welcome to Bloom</span></div>{welcomePrefix&&<div className="onboarding-emblem" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="9" width="22" height="17" rx="4"/><path d="m6 11 10 8 10-8M12 5h8"/></svg></div>}<h2 ref={heading} tabIndex={-1} id={titleId} className={stage==='listing'?'bloom-sr-only':'onboarding-title'}>{welcomePrefix?<><span className="onboarding-congrats">{welcomePrefix}</span>{title.slice(welcomePrefix.length).trim()}</>:title}</h2>
 {stage!=='listing'&&<p id={introId} className="onboarding-intro">{state.status==='blocked'?state.message:state.status==='complete'?'Your account setup is saved.':intro}</p>}
 {stage!=='listing'&&(state.status==='blocked'?<div className="onboarding-actions"><button className="bloom-button" disabled={busy} onClick={()=>void refresh()}>{busy?'Checking…':'Check invitation again'}</button><SignOutButton redirectUrl="/sign-in"><button type="button" className="bloom-button secondary">Sign out</button></SignOutButton></div>:state.status==='complete'?<div className="onboarding-actions">{listingStarted&&<button className="bloom-button" onClick={()=>setStage('listing')}>Continue to listing setup →</button>}<button className="bloom-button secondary" onClick={()=>router.replace(state.destination)}>Open my workspace →</button></div>:<form onSubmit={save} className="onboarding-form" aria-busy={busy}>
 {stage==='role'?<OnboardingRoleTiles role={role} onChange={setRole} disabled={locked}/>:<><fieldset disabled={locked}><legend className="bloom-sr-only">Your home base</legend>{activeRole==='cleaner'?<><label>Which city will you clean in? <span>(required)</span></label>{cities.loading?<Loading/>:cities.error?<ErrorNotice error={cities.error} retry={cities.reload}/>:<LocationDropdown label="Which city will you clean in?" ariaInvalid={fieldInvalid} describedBy={`${titleId}-helper ${titleId}-error`} locations={(cities.data??[]).filter(item=>item.active)} value={city} onValueChange={value=>{setCity(value);setValidation('');setError(undefined);}} disabled={locked}/>}<p id={`${titleId}-helper`} className="onboarding-helper">Choose your first city freely. Later city changes require admin approval.</p></>:<><label htmlFor={`${titleId}-city`}>What city are you based in? <span>(required)</span></label><input id={`${titleId}-city`} aria-invalid={fieldInvalid} aria-describedby={`${titleId}-helper ${titleId}-error`} maxLength={100} autoComplete="address-level2" placeholder="e.g. Detroit, MI" value={homeBase} onChange={event=>{setHomeBase(event.target.value);setValidation('');setError(undefined);}}/><p id={`${titleId}-helper`} className="onboarding-helper">Your home base for everything Bloom. This does not limit where your properties can be located.</p><label className="onboarding-listing-option"><input type="checkbox" checked={addListing} onChange={event=>setAddListing(event.target.checked)}/><span>Add a listing<small>Optional — you can always do this later.</small></span></label></>}</fieldset></>}
 {validation&&<p id={`${titleId}-error`} className="onboarding-error" role="alert">{validation}</p>}<div className="onboarding-actions"><button className="bloom-button" disabled={busy||(stage==='role'&&!role)||(stage==='setup'&&activeRole==='cleaner'&&!uncertain&&(cities.loading||!!cities.error))}>{busy?'Saving your setup…':uncertain?'Retry saving this setup':stage==='role'?'Continue →':activeRole==='owner'&&addListing?'Continue to listing setup →':'Let’s get started →'}</button>{state.status==='choose_role'&&stage==='setup'&&<button type="button" className="onboarding-back" disabled={locked} onClick={()=>setStage('role')}>Back</button>}</div>
 {uncertain&&!busy&&<p role="status">We could not confirm the save. Your original choices are kept for a safe retry.</p>}</form>)}
 {stage!=='listing'&&!!error&&<><div id={validation?undefined:`${titleId}-error`}><ErrorNotice error={error}/></div><button className="onboarding-back" type="button" disabled={busy} onClick={()=>void refresh()}>Check account status</button></>}
 {listingStarted&&<div hidden={stage!=='listing'}><button type="button" className="onboarding-back" disabled={listingBusy} onClick={()=>setStage('setup')}>Back to welcome</button><OwnerCreateListing embedded open listings={listings} onClose={()=>{if(state.status==='complete')router.replace(state.destination);}} onCreated={listing=>setListings(previous=>[...previous.filter(item=>item.id!==listing.id),listing])} onChanged={()=>void refreshListings()} onBusyChange={setListingBusy} onTitleChange={setListingTitle}/>{!!listingsError&&<ErrorNotice error={listingsError} retry={()=>void refreshListings()}/>}</div>}
 {stage!=='listing'&&<p className="onboarding-bottom-note">A little setup. Then you’re in.</p>}</div></dialog></div>;
}
