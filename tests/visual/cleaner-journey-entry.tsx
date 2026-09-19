// Isolated presentation fixture. All HTTP is intercepted by the visual test runner.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookingCalendar } from '../../src/components/ui/calendar';
import { JobDetail } from '../../src/components/bloom/cleaner';
import { ApiError } from '../../src/components/bloom/api';
let uploadAttempts=0;
import type { CleanerJob, SessionUser } from '../../src/contracts';
import '../../src/styles/bloom-cleaner.css';
import '../../src/styles/bloom-application.css';
const now=Date.now()+(new URLSearchParams(location.search).has('withdraw')?86400000:0);
export const fixture:CleanerJob={id:'test-job',propertyId:'test-property',propertyName:'ISOLATED TEST — Lake House',cityId:'test-city',checkoutDate:new Date(now).toISOString().slice(0,10),startAt:new Date(now-3600000).toISOString(),endAt:new Date(now+3600000).toISOString(),timezone:'America/Detroit',status:'open',reviewRequired:false,version:1,soloRateCents:7500,sharedRateCents:3750,activeCleanerCount:0,myAssignmentId:null,myCompletedPayCents:null,changes:[]};
function App(){const [closed,setClosed]=useState(false);const [job,setJob]=useState(()=>localStorage.getItem('bloom-journey:test-cleaner:test-job')?{...fixture,myAssignmentId:'test-assignment',activeCleanerCount:1}:fixture);const user:SessionUser={id:'test-cleaner',role:new URLSearchParams(location.search).get('role')==='admin'?'admin':'cleaner',displayName:'Test cleaner',approvedCityId:'test-city'};if(new URLSearchParams(location.search).has('calendar'))return <div className="bloom-cleaner cleaner-hub app"><BookingCalendar month="2026-09">{()=> <button className="day-pill open"><span className="dp-plus">+</span><span className="dp-label">Isolated long property name</span></button>}</BookingCalendar></div>;return <div className="bloom-cleaner cleaner-hub app">{!closed&&<JobDetail job={job} user={user} integration={{getInstructions:async()=>({instructions:'Isolated instruction fixture.'}),prepareUpload:async()=>({photoId:'test-upload',upload:async()=>{uploadAttempts++;if(uploadAttempts===1)throw new ApiError('NETWORK_ERROR','Isolated upload interruption.');}})}} onClose={()=>setClosed(true)} onUpdate={setJob} refresh={()=>{}}/>}</div>;}
createRoot(document.getElementById('root')!).render(<App/>);
