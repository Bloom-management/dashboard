import type { OwnerCalendarBlock } from '../../contracts';
const dayMs=86_400_000;
function dateNumber(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return NaN;const number=Date.parse(`${value}T00:00:00Z`);return Number.isFinite(number)&&new Date(number).toISOString().slice(0,10)===value?number:NaN;}
export function ownerRangeValid(from:string,toExclusive:string,maxNights=366){const nights=(dateNumber(toExclusive)-dateNumber(from))/dayMs;return Number.isInteger(nights)&&nights>=1&&nights<=maxNights;}
export function timelineDays(from:string,toExclusive:string){if(!ownerRangeValid(from,toExclusive))return [];const days=[];for(let value=dateNumber(from);value<dateNumber(toExclusive);value+=dayMs)days.push(new Date(value).toISOString().slice(0,10));return days;}
export function timelineSegments(blocks:OwnerCalendarBlock[],from:string,toExclusive:string){
 const starts:number[]=[];
 return blocks.filter(block=>block.startDate===block.endDate?block.startDate>=from&&block.startDate<toExclusive:block.startDate<toExclusive&&block.endDate>from).sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.id.localeCompare(b.id)).map(block=>{
  const start=(dateNumber(block.startDate<from?from:block.startDate)-dateNumber(from))/dayMs;
  const end=(dateNumber(block.endDate>toExclusive?toExclusive:block.endDate)-dateNumber(from))/dayMs;
  const sameDay=block.startDate===block.endDate;
  let lane=starts.findIndex(previous=>previous<=start);if(lane<0)lane=starts.length;
  // Reserve a visual marker cell for collision avoidance; event duration remains zero.
  starts[lane]=sameDay?start+1:end;
  return {block,start,end,lane,sameDay};
 });
}
export function occupancyLabel(occupancy:number|null){return occupancy===null?'Unavailable':`${new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(occupancy*100)}%`;}
