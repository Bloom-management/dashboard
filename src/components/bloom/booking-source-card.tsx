import Image from 'next/image';

/** Provider artwork is bundled locally so the summary doesn't depend on external image hosts. */
export function BookingSourceCard({providers}:{providers:readonly string[]}) {
 const sources=[...new Set(providers.map(provider=>provider==='airbnb'?'Airbnb':provider==='vrbo'?'Vrbo':'External'))];
 return <section className="bk-source-card" aria-label="Booking source"><h3>Booking source</h3><div className="bk-source-list">{(sources.length?sources:['External']).map(source=><div className="bk-source-brand" key={source}>{source==='Airbnb'?<><Image src="/images/booking-sources/airbnb.jpg" width={44} height={44} alt=""/><span>Airbnb</span></>:source==='Vrbo'?<span className="bk-source-vrbo"><Image src="/images/booking-sources/vrbo-transparent.png" width={1983} height={793} alt="Vrbo"/></span>:<span>External</span>}</div>)}</div></section>;
}

export function CalendarSourceBrand({provider}:{provider:string}){return <span className="bk-source-brand">{provider==='airbnb'?<Image src="/images/booking-sources/airbnb.jpg" width={44} height={44} alt=""/>:provider==='vrbo'?<span className="bk-source-vrbo"><Image src="/images/booking-sources/vrbo-transparent.png" width={1983} height={793} alt=""/></span>:null}<span>{provider==='airbnb'?'Airbnb':provider==='vrbo'?'Vrbo':'External'} calendar</span></span>;}
