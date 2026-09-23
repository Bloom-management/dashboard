'use client';
import {useEffect,useRef,useState} from 'react';
import type {Map as GLMap,Marker} from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {groupPoints,type MapPoint} from './points';
export default function JobMap({points,selected,onSelect,locate=true}:{points:MapPoint[];selected:string|null;onSelect:(id:string)=>void;locate?:boolean}){
 const container=useRef<HTMLDivElement>(null),map=useRef<GLMap|null>(null),markers=useRef<{marker:Marker;ids:string[]}[]>([]),locationMarker=useRef<Marker|null>(null),callback=useRef(onSelect),selection=useRef(selected),initial=useRef(points);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[locationMessage,setLocationMessage]=useState(''),[locating,setLocating]=useState(false);
 useEffect(()=>{callback.current=onSelect;selection.current=selected;},[onSelect,selected]);
 useEffect(()=>{
  let cancelled=false;let observer:ResizeObserver|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  const token=process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if(!token?.startsWith('pk.')){setError('The map is not configured. You can still view and claim cleanings from the list.');return;}
  void import('mapbox-gl').then(({default:gl})=>{
   if(cancelled||!container.current)return;
   if(!gl.supported())throw new Error('unsupported');
   const first=initial.current[0];const instance=new gl.Map({container:container.current,accessToken:token,style:'mapbox://styles/mapbox/light-v11',center:first?[first.longitude,first.latitude]:[0,0],zoom:first?13:1,attributionControl:false});map.current=instance;
   instance.addControl(new gl.AttributionControl({compact:false}),'bottom-right');instance.addControl(new gl.NavigationControl({showCompass:false}),'top-right');
   instance.on('error',()=>{if(!cancelled)setError('Some map details could not load. Use the job list if the map is unavailable.');});
   timer=setTimeout(()=>{if(!cancelled)setError('The map is taking too long to load. The job list is still available.');},15000);
   instance.once('load',()=>{if(cancelled)return;clearTimeout(timer);for(const layer of instance.getStyle().layers??[]){
    if(layer.type==='background')instance.setPaintProperty(layer.id,'background-color','#f6f3ec');
    else if(layer.type==='fill')instance.setPaintProperty(layer.id,'fill-color',layer.id.includes('water')?'#e3edf0':'#efebe1');
    else if(layer.type==='line'&&layer.id.includes('road'))instance.setPaintProperty(layer.id,'line-color','#ffffff');
    else if(layer.type==='symbol'&&layer.layout?.['text-field']){instance.setPaintProperty(layer.id,'text-color','#8a8270');instance.setPaintProperty(layer.id,'text-halo-color','#f6f3ec');}
   }setReady(true);});
   observer=new ResizeObserver(()=>instance.resize());observer.observe(container.current);
  }).catch(()=>{if(!cancelled)setError('The map could not load. You can still view and claim cleanings from the list.');});
  return()=>{cancelled=true;clearTimeout(timer);observer?.disconnect();map.current?.remove();map.current=null;};
 },[]);
 useEffect(()=>{if(!ready||!map.current)return;const instance=map.current;let cancelled=false;void import('mapbox-gl').then(({default:gl})=>{
  if(cancelled)return;markers.current.forEach(x=>x.marker.remove());markers.current=[];
  const bounds=new gl.LngLatBounds();for(const group of groupPoints(points)){
   const first=group[0];bounds.extend([first.longitude,first.latitude]);const button=document.createElement('button');button.type='button';button.className='bloom-map-marker';button.textContent=group.length>1?String(group.length):'•';button.setAttribute('aria-label',group.map(p=>p.label).join(', '));const active=group.some(p=>p.id===selection.current);button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));
   const marker=new gl.Marker({element:button}).setLngLat([first.longitude,first.latitude]).addTo(instance);
   button.onclick=()=>{callback.current(first.id);if(group.length>1){const menu=document.createElement('div');menu.className='bloom-map-units';for(const point of group){const choose=document.createElement('button');choose.type='button';choose.textContent=point.label;choose.onclick=()=>callback.current(point.id);menu.appendChild(choose);}marker.setPopup(new gl.Popup({offset:20}).setDOMContent(menu)).togglePopup();}};
   markers.current.push({marker,ids:group.map(p=>p.id)});
  }
  if(!bounds.isEmpty())instance.fitBounds(bounds,{padding:60,maxZoom:15,duration:0});
 });return()=>{cancelled=true;};},[points,ready]);
 useEffect(()=>{for(const entry of markers.current){const active=!!selected&&entry.ids.includes(selected);entry.marker.getElement().classList.toggle('selected',active);entry.marker.getElement().setAttribute('aria-pressed',String(active));}},[selected,ready,points]);
 async function useLocation(){if(!navigator.geolocation){setLocationMessage('Location is unavailable. Your job list is unchanged.');return;}setLocating(true);setLocationMessage('');navigator.geolocation.getCurrentPosition(async position=>{if(!map.current)return;const {default:gl}=await import('mapbox-gl');if(!map.current)return;locationMarker.current?.remove();locationMarker.current=new gl.Marker({color:'#8a8270'}).setLngLat([position.coords.longitude,position.coords.latitude]).addTo(map.current);map.current.easeTo({center:[position.coords.longitude,position.coords.latitude],zoom:13});setLocating(false);setLocationMessage('Your approximate location is shown for this open map only.');},()=>{if(!map.current)return;setLocating(false);setLocationMessage('Location was denied or unavailable. You can still use the map and job list.');},{enableHighAccuracy:false,timeout:10000,maximumAge:0});}
 return <section className="bloom-job-map" aria-label="Map of selected-day cleanings"><div ref={container} className="bloom-map-canvas"/>{!!error&&<p role="status">{error}</p>}{locate&&<button type="button" className="bloom-button secondary" disabled={!ready||locating} onClick={()=>void useLocation()}>{locating?'Finding location…':'Use my location'}</button>}{!!locationMessage&&<p role="status">{locationMessage}</p>}</section>;
}
