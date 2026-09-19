'use client';
import {useState} from 'react';
import {SignIn,SignUp} from '@clerk/nextjs';
import {IncomingInvitations} from './property-people';
export function PropertyInvitationEntry({signedIn}:{signedIn:boolean}){
 const[existing,setExisting]=useState(false);return <main className="bloom-owner" style={{minHeight:'100dvh',padding:'32px 20px'}}><div className="bloom-admin-card" style={{maxWidth:620,margin:'0 auto'}}><h1>Bloom property invitation</h1>{signedIn?<><IncomingInvitations/><a href="/">Return to your hub</a></>:<><p>Sign in or create an account using the invited email, then accept your property invitation.</p><button className="bloom-button secondary" onClick={()=>setExisting(!existing)}>{existing?'Create an account':'Already have an account? Sign in'}</button>{existing?<SignIn routing="hash" forceRedirectUrl="/invitations"/>:<SignUp routing="hash" forceRedirectUrl="/invitations" signInUrl="/sign-in?redirect_url=%2Finvitations"/>}</>}</div></main>;
}
