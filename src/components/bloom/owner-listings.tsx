'use client';
import {SelectorPill} from './selector-pill';
import {CarouselArrows} from './carousel-arrows';
import {RoomSpaces} from './room-listings/spaces';
import {HousePricing} from './room-listings/pricing';
import {ListingDrafts,HouseItems} from './room-listings/drafts';
import {SupplyLevelBar} from './supply-level-bar';
import {SupplyConfiguration} from './cleaning-config';
import {PropertyThumbnail,PropertyThumbnailSettings} from './property-thumbnail';
import {SupplyPurchases} from './supply-purchases';
import {RemovableItem} from './removable-item';
import {AddCard} from './add-card';
import type {CleaningConfig} from '../../contracts';
import {AnimatedContent} from './animated-content';
import {AccessInfo} from './access-info';
import {CleaningTeamPanel} from './cleaning-team-panel';
import {PropertyNightlyRate} from './property-nightly-rate';
import {PropertyAvatars,PropertyPeoplePanel} from './property-people';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { OwnerListing, OwnerPerformance, OwnerSupply } from '../../contracts/owner-hub';
import type { BloomIntegration } from './integration';
import { request } from './api';
import { Empty, ErrorNotice, Icon, Loading, useResource } from './primitives';
import {BackButton} from './back-button';
import { PropertyName } from './property-name';
import { OwnerSources } from './owner-sources';
import { CleaningConfiguration } from './cleaning-config';
import { MaintenanceGrid as OwnerMaintenance } from './maintenance';
import { PropertyDelete } from './property-delete';
import { OwnerPlatformShare as PlatformShareChart } from './owner-performance';
import { ArchivedListings, RentalModelSettings, modelChip, railStyles } from './rental-model';

const supplyLabels={full:'Full',moderate:'Moderate',low:'Low',empty:'Empty',not_found:'Not found'};
export function OwnerSupplySummary({listing,onChanged,preview=false}:{listing:OwnerListing;onChanged?:()=>void;preview?:boolean}){
 const [adding,setAdding]=useState(false);
 const [selected,setSelected]=useState<OwnerSupply|null>(null);
 async function removeSupply(supply:OwnerSupply){const path=`/owner/properties/${listing.id}/cleaning-config`;const config=await request<CleaningConfig|null>(path);if(config?.supplies.some(s=>s.id===supply.supplyId))await request(path,{body:{...config,supplies:config.supplies.filter(s=>s.id!==supply.supplyId)},key:crypto.randomUUID()});onChanged?.();}
 return <><h3>Supplies</h3>{listing.suppliesUnavailable?<p>Supply reports are not available in the admin Owner Hub view yet.</p>:<><p>{listing.supplies.length?'Supplies default to Full until updated by a cleaner':'No supplies are configured for this unit yet.'}</p><div className="owner-supply-grid">{listing.supplies.map(supply=><RemovableItem key={supply.supplyId} name={supply.name} kind="supply" enabled={!preview} onRemove={()=>removeSupply(supply)}><button type="button" disabled={preview} onClick={()=>setSelected(supply)} aria-label={`${supply.name} purchases and restocks`} className="owner-supply-card" data-level={supply.level??'full'}><svg width="28" height="32" viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M10 3h8v5l4 5v15H6V13l4-5V3ZM10 8h8M6 18h16M18 3h5"/></svg><strong>{supply.name}</strong><span>{supplyLabels[supply.level??'full']}</span><SupplyLevelBar level={supply.level??'full'}/><small>{supply.restockIsLatest?`Restocked ${supply.lastRestockedDate}`:supply.reportedAt?`Last reported ${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:listing.timezone}).format(new Date(supply.reportedAt))} (${listing.timezone})`:'Default level · No cleaner report yet'}</small></button></RemovableItem>)}{!preview&&<AddCard label="Add supply" onClick={()=>setAdding(true)}/>}</div></>}{adding&&<SupplyConfiguration propertyId={listing.id} onClose={()=>setAdding(false)} onSaved={()=>onChanged?.()}/ >}{selected&&<SupplyPurchases listing={listing} supply={selected} onClose={()=>setSelected(null)} onSaved={()=>onChanged?.()}/>}</>;

}
export { OwnerSources } from './owner-sources';

function OwnerPlatformShare({id,from,toExclusive,revision}:{id:string;from:string;toExclusive:string;revision:number}) {
 const load=useCallback((signal:AbortSignal)=>request<OwnerPerformance>(`/owner/performance?${new URLSearchParams({from,toExclusive,propertyId:id})}`,{signal}),[id,from,toExclusive,revision]);
 const data=useResource(load);
 return <section aria-label="Listing platform share"><h3>Platform share</h3><p>{from} to {toExclusive} (end exclusive) · Based on known occupied nights</p>{data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:data.data&&<><PlatformShareChart totals={data.data.totals}/></>}</section>;
}
function OwnerListingDetails({listing,onChanged,from,toExclusive,revision,settingsContent,calendarContent,admin=false}:{listing:OwnerListing;onChanged:()=>void;from:string;toExclusive:string;revision:number;settingsContent?:ReactNode;calendarContent?:ReactNode;admin?:boolean}) {

 const [slide,setSlide]=useState(0);useEffect(()=>{const section=new URLSearchParams(window.location.search).get('section');const index=({supplies:1,maintenance:2,settings:3} as Record<string,number>)[section??''];if(index!==undefined)setSlide(index);},[listing.id]);const names=['Rate','Supplies','Maintenance','Settings','Cleaning team','Coverage','Calendars'];
 return <article className="owner-listing-detail" aria-label={`${listing.name} details`}><h2>{listing.name}</h2><p>{listing.active?'Active':'Inactive'} · {listing.timezone}</p><div className="owner-detail-navigation"><SelectorPill role="group" aria-label="Property information">{names.map((name,index)=><button type="button" key={name} className={`vt-btn${slide===index?' active':''}`} aria-pressed={slide===index} onClick={()=>setSlide(index)}>{name}</button>)}</SelectorPill><CarouselArrows label="property section" onPrevious={()=>setSlide((slide+names.length-1)%names.length)} onNext={()=>setSlide((slide+1)%names.length)}/></div><AnimatedContent><div role="region" aria-roledescription="carousel" aria-label="Property details"><div hidden={slide!==0} role="group" aria-label="Rate, 1 of 7"><h3>Rate</h3><PropertyNightlyRate listing={listing} onSaved={onChanged}/><OwnerPlatformShare id={listing.id} from={from} toExclusive={toExclusive} revision={revision}/></div><div hidden={slide!==1} role="group" aria-label="Supplies, 2 of 7">{listing.houseId?(slide===1&&<HouseItems propertyId={listing.id} fixedSection="supply"/>):<OwnerSupplySummary listing={listing} onChanged={onChanged}/>}</div><div hidden={slide!==2} role="group" aria-label="Maintenance, 3 of 7">{listing.houseId?(slide===2&&<HouseItems propertyId={listing.id} fixedSection="maintenance"/>):<><OwnerMaintenance reports={listing.maintenance}/>{slide===2&&<><h4>Listing checks</h4><HouseItems propertyId={listing.id} fixedSection="maintenance" wholeHome/></>}</>}</div><div hidden={slide!==3} role="group" aria-label="Settings, 4 of 7">{slide===3&&<RentalModelSettings listing={listing} onChanged={onChanged}/>}{listing.houseId&&<HousePricing propertyId={listing.id}/>} {settingsContent??<><div className="owner-settings-heading"><h3>Settings</h3></div>{listing.setupRequired&&<p className="bloom-notice">Finish your room setup below to make cleaning jobs available.</p>}<PropertyThumbnailSettings key={listing.id} id={listing.id}/><h3>Access info</h3><AccessInfo propertyId={listing.id}/>{listing.houseId?<><RoomSpaces propertyId={listing.id}/><PropertyPeoplePanel listing={listing}/></>:<CleaningConfiguration propertyId={listing.id} owner bedroomCount={listing.bedroomCount} bathroomCount={listing.bathroomCount} onSaved={onChanged} people={<PropertyPeoplePanel listing={listing}/>}/>}</>}</div><div hidden={slide!==4} role="group" aria-label="Cleaning team, 5 of 7">{slide===4&&<CleaningTeamPanel admin={admin} propertyId={listing.id} onChanged={onChanged}/>}</div><div hidden={slide!==5} role="group" aria-label="Coverage, 6 of 7">{slide===5&&<CleaningTeamPanel view="coverage" admin={admin} propertyId={listing.id} onChanged={onChanged}/>}</div><div hidden={slide!==6} role="group" aria-label="Calendars, 7 of 7">{slide===6&&(calendarContent??<OwnerSources listing={listing} onChanged={onChanged}/>)}</div></div></AnimatedContent></article>;
}
export function OwnerListings({listings,integration,onChanged,from,toExclusive,revision,addListingAction,initialSelectedId,renderSettings,renderCalendars,admin=false}:{listings:OwnerListing[];integration:BloomIntegration;onChanged:()=>void;from:string;toExclusive:string;revision:number;addListingAction?:ReactNode;initialSelectedId?:string;renderSettings?:(listing:OwnerListing)=>ReactNode;renderCalendars?:(listing:OwnerListing)=>ReactNode;admin?:boolean}){
 const [selectedId,setSelectedId]=useState<string|null>(initialSelectedId??null);
 const ready=listings.filter(p=>!p.isDraft&&!p.isArchived);
 const archived=listings.filter(p=>p.isArchived);
 const [openHouses,setOpenHouses]=useState<Set<string>>(()=>new Set());const [closedHouses,setClosedHouses]=useState<Set<string>>(()=>new Set());
 const selected=ready.find(p=>p.id===selectedId)??ready[0];
 // Drafts live on their own page (?listings=drafts), reached from the dashed Drafts card at the end of the list.
 const [drafts,setDrafts]=useState(false);
 useEffect(()=>{const sync=()=>setDrafts(new URLSearchParams(window.location.search).get('listings')==='drafts');sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
 // Board D rail: a room-model house is one group card holding its rooms; plain units keep their card.
 const railItems=ready.reduce<({kind:'unit';listing:OwnerListing}|{kind:'house';houseId:string;rooms:OwnerListing[]})[]>((items,listing)=>{if(!listing.houseId){items.push({kind:'unit',listing});return items;}const group=items.find(i=>i.kind==='house'&&i.houseId===listing.houseId);if(group&&group.kind==='house')group.rooms.push(listing);else items.push({kind:'house',houseId:listing.houseId,rooms:[listing]});return items;},[]);
 const openDrafts=()=>{const url=new URL(window.location.href);url.searchParams.set('listings','drafts');window.history.pushState(null,'',url);setDrafts(true);};
 const closeDrafts=()=>{const url=new URL(window.location.href);url.searchParams.delete('listings');window.history.pushState(null,'',url);setDrafts(false);};
 const draftCount=listings.filter(p=>p.isDraft).length+archived.length;
 const draftsCard=<button type="button" className="owner-drafts-card" onClick={openDrafts}><strong>Drafts &amp; archived</strong>{draftCount>0&&<small>{draftCount}</small>}<span className="owner-drafts-chevron"><Icon name="right"/></span></button>;
 if(drafts)return <section className="owner-listings-section owner-drafts-page" aria-label="Listing drafts and archived listings"><BackButton onClick={closeDrafts}>Back to listings</BackButton><h2>Drafts &amp; archived</h2><h3>Drafts</h3><ListingDrafts onChanged={onChanged} allowCreate={false}/><ArchivedListings listings={archived}/></section>;
 return <section className="owner-listings-section" aria-label="Your listings"><div className="loc-header"><h2>Listings</h2>{addListingAction}</div>{!selected?(draftCount?<div className="owner-drafts-only">{draftsCard}</div>:<Empty title="No properties yet">Add a listing to get started.</Empty>):<div className="owner-listings-split"><nav className="owner-listings-rail" aria-label="Properties">{draftsCard}{railItems.map(item=>item.kind==='unit'?(({listing})=><div key={listing.id} className="owner-property-card-wrap"><div className={`owner-property-card${listing.id===selected.id?' active':''}`}><button type="button" className="owner-property-select" aria-label={`Select ${listing.name}`} aria-pressed={listing.id===selected.id} onClick={()=>setSelectedId(listing.id)}/><div className="owner-property-cover-heading"><PropertyThumbnail id={listing.id} placeholder={false}/><div className="owner-property-title"><strong>{listing.name.trimEnd().replace(/\S+$/,'')}</strong><div className="owner-property-title-ending"><strong>{listing.name.trimEnd().match(/\S+$/)?.[0]}</strong><PropertyName property={listing} rename={integration.renameProperty} onSaved={onChanged}/></div><span className={railStyles.railChip}>{modelChip(listing,0)}</span></div></div><span className="property-card-footer"><span>{listing.cityName??listing.timezone}</span><PropertyAvatars propertyId={listing.id}/></span></div><PropertyDelete property={listing} onDeleted={onChanged} iconOnly/></div>)(item):<HouseGroup key={item.houseId} rooms={item.rooms} selectedId={selected.id} open={item.rooms.some(r=>r.id===selected.id)?!closedHouses.has(item.houseId):openHouses.has(item.houseId)} onToggle={()=>{const toggle=(o:Set<string>)=>{const next=new Set(o);if(next.has(item.houseId))next.delete(item.houseId);else next.add(item.houseId);return next;};if(item.rooms.some(r=>r.id===selected.id))setClosedHouses(toggle);else setOpenHouses(toggle);}} onSelect={setSelectedId}/>)}</nav><OwnerListingDetails admin={admin} settingsContent={renderSettings?.(selected)} calendarContent={renderCalendars?.(selected)} key={selected.id} listing={selected} onChanged={onChanged} from={from} toExclusive={toExclusive} revision={revision}/></div>}</section>;
}

function HouseGroup({rooms,selectedId,open,onToggle,onSelect}:{rooms:OwnerListing[];selectedId:string;open:boolean;onToggle:()=>void;onSelect:(id:string)=>void}){
 const first=rooms[0];const ordered=[...rooms].sort((a,b)=>(a.roomIdentifier??a.name).localeCompare(b.roomIdentifier??b.name,undefined,{numeric:true}));const active=rooms.some(r=>r.id===selectedId);const listId=`house-rooms-${first.houseId}`;
 return <div className={`${railStyles.houseGroup}${active?` ${railStyles.houseGroupActive}`:''}${open?` ${railStyles.open}`:''}`}>
  <button type="button" className={railStyles.houseHead} aria-expanded={open} aria-controls={listId} onClick={onToggle}><span className={railStyles.houseIcon} aria-hidden="true"><PropertyThumbnail key={ordered[0].id} id={ordered[0].id} fill fallback={<Icon name="house" size={22}/>}/></span><span className={railStyles.houseText}><strong>{first.houseName??first.name}</strong><small>{first.cityName??first.timezone}</small>{modelChip(first,rooms.length)}</span><span className={railStyles.chevron} aria-hidden="true"><Icon name="right"/></span></button>
  <div className="property-card-footer"><span/><PropertyAvatars propertyId={first.id}/></div>
  {open&&<ul id={listId} className={railStyles.houseRooms}>{ordered.map(r=><li key={r.id}><button type="button" aria-pressed={r.id===selectedId} aria-label={`Select ${r.name}`} onClick={()=>onSelect(r.id)}><span className={`${railStyles.dot} ${railStyles[r.status??'']??''}`} aria-hidden="true"/>{r.roomIdentifier??r.name}<span>{r.nightlyGuestRateCents!=null?`$${(r.nightlyGuestRateCents/100).toFixed(0)}`:''}</span></button></li>)}</ul>}
 </div>;
}
