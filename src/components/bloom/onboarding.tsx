 'use client';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { LocationDropdown } from './location-dropdown';
import { api, request } from './api';
import { Brand, ErrorNotice, Loading, useResource } from './primitives';
import type { CityOption } from './integration';
export function Onboarding() {
 const router=useRouter(); const [city,setCity]=useState(''); const [error,setError]=useState<unknown>(); const [busy,setBusy]=useState(false); const key=useRef(crypto.randomUUID()); const lock=useRef(false);
 const load=useCallback((signal:AbortSignal)=>request<CityOption[]>('/cities',{signal}),[]); const cities=useResource(load);
 return <div className="bloom-cleaner app"><header className="topbar"><Brand role="cleaner"/><div className="topbar-right"><UserButton/></div></header><main className="main-inner"><h1>Choose your first city</h1><p>You can choose freely now. Later city changes need admin approval.</p>{cities.loading?<Loading/>:cities.error?<ErrorNotice error={cities.error} retry={cities.reload}/>:<form className="bloom-form" onSubmit={async e=>{e.preventDefault();if(lock.current||!city)return;lock.current=true;setBusy(true);try{await api.selectCity(city,key.current);router.replace('/cleaner');router.refresh();}catch(failure){setError(failure);}finally{lock.current=false;setBusy(false);}}}><div className="onboarding-city-field"><span>City</span><LocationDropdown label="City" locations={cities.data??[]} value={city} onValueChange={setCity} disabled={busy}/></div><button className="bloom-button" disabled={busy||!city}>{busy?'Saving…':'Continue'}</button></form>}{!!error&&<ErrorNotice error={error}/>}</main></div>;
}
