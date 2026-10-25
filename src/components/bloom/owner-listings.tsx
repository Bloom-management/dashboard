'use client';
import {SupplyLevelBar} from './supply-level-bar';
import {ButtonContent} from './button-content';
import {SupplyConfiguration} from './cleaning-config';
import {PropertyThumbnailSettings} from './property-thumbnail';
import {SupplyPurchases} from './supply-purchases';
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
import { PropertyName } from './property-name';
import { OwnerSources } from './owner-sources';
import { CleaningConfiguration } from './cleaning-config';
import { MaintenanceGrid as OwnerMaintenance } from './maintenance';
import { PropertyDelete } from './property-delete';
import { OwnerPlatformShare as PlatformShareChart } from './owner-performance';

const supplyLabels={full:'Full',moderate:'Moderate',low:'Low',empty:'Empty',not_found:'Not found'};
export function OwnerSupplySummary({listing,onChanged,preview=false}:{listing:OwnerListing;onChanged?:()=>void;preview?:boolean}){
 const [adding,setAdding]=useState(false);
 const [selected,setSelected]=useState<OwnerSupply|null>(null);
 return <><h3>Supplies</h3>{listing.suppliesUnavailable?<p>Supply reports are not available in the admin Owner Hub view yet.</p>:<><p>{listing.supplies.length?'Supplies default to Full until updated by a cleaner':'No supplies are configured for this unit yet.'}</p><div className="owner-supply-grid">{listing.supplies.map(supply=><button type="button" disabled={preview} onClick={()=>setSelected(supply)} aria-label={`${supply.name} purchases and restocks`} className="owner-supply-card" key={supply.supplyId} data-level={supply.level??'full'}><svg width="28" height="32" viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M10 3h8v5l4 5v15H6V13l4-5V3ZM10 8h8M6 18h16M18 3h5"/></svg><strong>{supply.name}</strong><span>{supplyLabels[supply.level??'full']}</span><SupplyLevelBar level={supply.level??'full'}/><small>{supply.restockIsLatest?`Restocked ${supply.lastRestockedDate}`:supply.reportedAt?`Last reported ${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:listing.timezone}).format(new Date(supply.reportedAt))} (${listing.timezone})`:'Default level · No cleaner report yet'}</small></button>)}{!preview&&<button type="button" className="owner-supply-card owner-supply-add" onClick={()=>setAdding(true)}><ButtonContent icon={<span className="owner-supply-plus">+</span>}>Add supply</ButtonContent></button>}</div></>}{adding&&<SupplyConfiguration propertyId={listing.id} onClose={()=>setAdding(false)} onSaved={()=>onChanged?.()}/ >}{selected&&<SupplyPurchases listing={listing} supply={selected} onClose={()=>setSelected(null)} onSaved={()=>onChanged?.()}/>}</>;

}
export { OwnerSources } from './owner-sources';

function OwnerPlatformShare({id,from,toExclusive,revision}:{id:string;from:string;toExclusive:string;revision:number}) {
 const load=useCallback((signal:AbortSignal)=>request<OwnerPerformance>(`/owner/performance?${new URLSearchParams({from,toExclusive,propertyId:id})}`,{signal}),[id,from,toExclusive,revision]);
 const data=useResource(load);
 return <section aria-label="Listing platform share"><h3>Platform share</h3><p>{from} to {toExclusive} (end exclusive) · Based on known occupied nights</p>{data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:data.data&&<>{data.data.totals.coverage.status!=='complete'&&<p>{data.data.totals.coverage.message}</p>}<PlatformShareChart totals={data.data.totals}/></>}</section>;
}
function OwnerListingDetails({listing,onChanged,from,toExclusive,revision,settingsContent,calendarContent,admin=false}:{listing:OwnerListing;integration:BloomIntegration;onChanged:()=>void;from:string;toExclusive:string;revision:number;settingsContent?:ReactNode;calendarContent?:ReactNode;admin?:boolean}) {

 const [slide,setSlide]=useState(0);useEffect(()=>{const section=new URLSearchParams(window.location.search).get('section');const index=({supplies:1,maintenance:2,settings:3} as Record<string,number>)[section??''];if(index!==undefined)setSlide(index);},[listing.id]);const names=['Rate','Supplies','Maintenance','Settings','Cleaning team','Coverage','Calendars'];
 return <article className="owner-listing-detail" aria-label={`${listing.name} details`}><h2>{listing.name}</h2><p>{listing.active?'Active':'Inactive'} · {listing.timezone}</p><div className="owner-detail-navigation"><div className="view-toggle" role="group" aria-label="Property information">{names.map((name,index)=><button key={name} className={`vt-btn${slide===index?' active':''}`} aria-pressed={slide===index} onClick={()=>setSlide(index)}>{name}</button>)}</div><div className="owner-carousel-controls"><button className="icon-btn" aria-label="Previous property section" onClick={()=>setSlide((slide+names.length-1)%names.length)}><Icon name="left"/></button><button className="icon-btn" aria-label="Next property section" onClick={()=>setSlide((slide+1)%names.length)}><Icon name="right"/></button></div></div><AnimatedContent><div role="region" aria-roledescription="carousel" aria-label="Property details"><div hidden={slide!==0} role="group" aria-label="Rate, 1 of 7"><h3>Rate</h3><PropertyNightlyRate listing={listing} onSaved={onChanged}/><OwnerPlatformShare id={listing.id} from={from} toExclusive={toExclusive} revision={revision}/></div><div hidden={slide!==1} role="group" aria-label="Supplies, 2 of 7"><OwnerSupplySummary listing={listing} onChanged={onChanged}/></div><div hidden={slide!==2} role="group" aria-label="Maintenance, 3 of 7"><OwnerMaintenance reports={listing.maintenance}/></div><div hidden={slide!==3} role="group" aria-label="Settings, 4 of 7">{settingsContent??<><div className="owner-settings-heading"><h3>Settings</h3></div>{listing.setupRequired&&<p className="bloom-notice">Finish your room setup below to make cleaning jobs available.</p>}<PropertyThumbnailSettings key={listing.id} id={listing.id}/><h3>Access info</h3><AccessInfo propertyId={listing.id}/><CleaningConfiguration propertyId={listing.id} owner bedroomCount={listing.bedroomCount} bathroomCount={listing.bathroomCount} onSaved={onChanged} people={<PropertyPeoplePanel listing={listing}/>}/></>}</div><div hidden={slide!==4} role="group" aria-label="Cleaning team, 5 of 7">{slide===4&&<CleaningTeamPanel admin={admin} propertyId={listing.id} onChanged={onChanged}/>}</div><div hidden={slide!==5} role="group" aria-label="Coverage, 6 of 7">{slide===5&&<CleaningTeamPanel view="coverage" admin={admin} propertyId={listing.id} onChanged={onChanged}/>}</div><div hidden={slide!==6} role="group" aria-label="Calendars, 7 of 7">{slide===6&&(calendarContent??<OwnerSources listing={listing} onChanged={onChanged}/>)}</div></div></AnimatedContent></article>;
}
export function OwnerListings({listings,integration,onChanged,from,toExclusive,revision,addListingAction,initialSelectedId,renderSettings,renderCalendars,admin=false}:{listings:OwnerListing[];integration:BloomIntegration;onChanged:()=>void;from:string;toExclusive:string;revision:number;addListingAction?:ReactNode;initialSelectedId?:string;renderSettings?:(listing:OwnerListing)=>ReactNode;renderCalendars?:(listing:OwnerListing)=>ReactNode;admin?:boolean}){
 const [selectedId,setSelectedId]=useState<string|null>(initialSelectedId??null);
 const selected=listings.find(p=>p.id===selectedId)??listings[0];
 return <section className="owner-listings-section" aria-label="Your listings"><div className="loc-header"><h2>Listings</h2>{addListingAction}</div>{!selected?<Empty title="No properties yet">Add a listing to get started.</Empty>:<div className="owner-listings-split"><nav className="owner-listings-rail" aria-label="Properties">{listings.map(listing=><div key={listing.id} className="owner-property-card-wrap"><div className={`owner-property-card${listing.id===selected.id?' active':''}`}><button type="button" className="owner-property-select" aria-label={`Select ${listing.name}`} aria-pressed={listing.id===selected.id} onClick={()=>setSelectedId(listing.id)}/><div className="owner-property-title"><strong>{listing.name.trimEnd().replace(/\S+$/,'')}</strong><div className="owner-property-title-ending"><strong>{listing.name.trimEnd().match(/\S+$/)?.[0]}</strong><PropertyName property={listing} rename={integration.renameProperty} onSaved={onChanged}/></div></div><span className="property-card-footer"><span>{listing.cityName??listing.timezone}</span><PropertyAvatars propertyId={listing.id}/></span></div><PropertyDelete property={listing} onDeleted={onChanged} iconOnly/></div>)}</nav><OwnerListingDetails admin={admin} settingsContent={renderSettings?.(selected)} calendarContent={renderCalendars?.(selected)} key={selected.id} listing={selected} integration={integration} onChanged={onChanged} from={from} toExclusive={toExclusive} revision={revision}/></div>}</section>;
}
