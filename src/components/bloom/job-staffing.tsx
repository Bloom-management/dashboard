'use client';
import {useCallback,useMemo,useRef,useState,type FormEvent} from 'react';
import {Popover} from '@base-ui/react/popover';
import type {CleanerJob} from '../../contracts';
import type {AdminPerson,BloomIntegration} from './integration';
import {request} from './api';
import {ErrorNotice,Icon,Loading,Modal,useResource} from './primitives';
import {CleanerAvatar} from './cleaner-identity';
import {DropdownMenu,DropdownMenuContent,DropdownMenuGroup,DropdownMenuItem,DropdownMenuTrigger} from '../ui/dropdown-menu';
import {Result,useMutation} from './admin-shared';

type StaffAssignment={id:string;cleanerId?:string;cleanerName:string;avatarUrl?:string|null};
type Cleaner=Pick<AdminPerson,'id'|'displayName'|'avatarUrl'>;
type StaffAction={kind:'assign';cleaner:Cleaner}|{kind:'reassign'|'remove';assignment:StaffAssignment};
const chevronDown=<svg className="bloom-staff-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;

/** Every eligible cleaner (admins, and cleaners approved for the job's city), across all directory pages. */
function useEligibleCleaners(integration:BloomIntegration,cityId:string){
  const load=useCallback(async(signal:AbortSignal)=>{
    if(!integration.admin)return [] as Cleaner[];
    const result:AdminPerson[]=[];let cursor:string|null=null;
    do{const page=await integration.admin.users(cursor,signal);result.push(...page.items);if(page.nextCursor===cursor&&cursor!==null)throw new Error('Directory did not advance');cursor=page.nextCursor;}while(cursor);
    return result.filter(person=>person.role==='admin'||(person.role==='cleaner'&&person.approvedCityId===cityId)).sort((a,b)=>a.displayName.localeCompare(b.displayName));
  },[integration,cityId]);
  return useResource(load);
}

/** Search bar on top, matching cleaners below. Clicking a cleaner picks them. */
function CleanerSearch({cleaners,exclude,onPick,selectedId,autoFocus=false}:{cleaners:ReturnType<typeof useEligibleCleaners>;exclude:Set<string>;onPick:(cleaner:Cleaner)=>void;selectedId?:string;autoFocus?:boolean}){
  const [query,setQuery]=useState('');
  const matches=useMemo(()=>{const q=query.trim().toLowerCase();return (cleaners.data??[]).filter(person=>!exclude.has(person.id)&&(!q||person.displayName.toLowerCase().includes(q)));},[cleaners.data,exclude,query]);
  return <div className="bloom-staff-search">
    <input type="search" className="bloom-staff-search-input" placeholder="Search cleaners" aria-label="Search cleaners" value={query} onChange={event=>setQuery(event.target.value)} autoFocus={autoFocus}/>
    {cleaners.loading&&!cleaners.data?<Loading/>:cleaners.error?<ErrorNotice error={cleaners.error} retry={cleaners.reload}/>:<ul className="bloom-staff-results" role="listbox" aria-label="Cleaners">
      {matches.map(person=><li key={person.id}><button type="button" role="option" aria-selected={selectedId===person.id} className="bloom-staff-result" onClick={()=>onPick(person)}><span className="bloom-staff-avatar small"><CleanerAvatar name={person.displayName} url={person.avatarUrl}/></span><span>{person.displayName}</span></button></li>)}
      {!matches.length&&<li className="bloom-staff-empty">{query.trim()?'No cleaners match.':'No eligible cleaners.'}</li>}
    </ul>}
  </div>;
}

/** "Who's working": one slot per seat. Assigned slots open Reassign / Remove; open slots open a cleaner search. */
export function JobStaffing({job,integration,assignments,onChanged}:{job:CleanerJob;integration:BloomIntegration;assignments:ReturnType<typeof useResource<StaffAssignment[]|null>>;onChanged:()=>void}){
  const [action,setAction]=useState<StaffAction|null>(null);
  const [openSlot,setOpenSlot]=useState<string|null>(null);
  const root=useRef<HTMLElement>(null);
  const cleaners=useEligibleCleaners(integration,job.cityId);
  const assigned=assignments.data??[];
  const seats=Math.max(job.capacity??2,assigned.length);
  // Popups render inside the job dialog (top layer); portalling to <body> would put them behind it.
  const dialog=root.current?.closest('dialog')??undefined;
  const taken=useMemo(()=>new Set(assigned.flatMap(item=>item.cleanerId?[item.cleanerId]:[])),[assigned]);
  const canAssign=!!integration.admin?.assignJob;
  return <section ref={root} className="bloom-admin-card bloom-staffing" aria-label="Who's working"><div className="bloom-staffing-head"><h3>Who&apos;s working</h3><span>{assigned.length} of {seats}</span></div>
    {assignments.loading&&!assignments.data?<Loading/>:assignments.error?<ErrorNotice error={assignments.error} retry={assignments.reload}/>:<ul className="bloom-staff-slots">{Array.from({length:seats},(_,index)=>{const person=assigned[index];const slotKey=person?.id??`open-${index}`;
      const body=<>{person?<span className="bloom-staff-avatar"><CleanerAvatar name={person.cleanerName} url={person.avatarUrl}/></span>:<span className="bloom-staff-avatar open" aria-hidden="true"><Icon name="plus" size={18}/></span>}<span className="bloom-staff-text"><strong>{person?person.cleanerName:'Open slot'}</strong><span>{person?'Assigned':canAssign?'Assign a cleaner':'No cleaner yet'}</span></span>{chevronDown}</>;
      return <li key={slotKey}>{person?<DropdownMenu open={openSlot===slotKey} onOpenChange={open=>setOpenSlot(open?slotKey:null)}><DropdownMenuTrigger className="bloom-staff-slot" aria-label={`${person.cleanerName}: reassign or remove`}>{body}</DropdownMenuTrigger><DropdownMenuContent container={dialog} collisionBoundary={dialog}><DropdownMenuGroup><DropdownMenuItem onClick={()=>setAction({kind:'reassign',assignment:person})}>Reassign</DropdownMenuItem><DropdownMenuItem onClick={()=>setAction({kind:'remove',assignment:person})}>Remove</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
        :<Popover.Root open={openSlot===slotKey} onOpenChange={open=>setOpenSlot(open?slotKey:null)}><Popover.Trigger className="bloom-staff-slot open" disabled={!canAssign} aria-label="Open slot: assign a cleaner">{body}</Popover.Trigger><Popover.Portal container={dialog}><Popover.Positioner className="bloom-staff-positioner" side="bottom" align="start" sideOffset={8} collisionPadding={12} collisionBoundary={dialog}><Popover.Popup className="bloom-staff-popover" aria-label="Assign a cleaner"><CleanerSearch cleaners={cleaners} exclude={taken} autoFocus onPick={cleaner=>{setOpenSlot(null);setAction({kind:'assign',cleaner});}}/></Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root>}</li>;})}</ul>}
    {action&&<StaffActionDialog job={job} integration={integration} action={action} cleaners={cleaners} taken={taken} onClose={()=>setAction(null)} onDone={()=>{setAction(null);assignments.reload();onChanged();}}/>}
  </section>;
}

function StaffActionDialog({job,integration,action,cleaners,taken,onClose,onDone}:{job:CleanerJob;integration:BloomIntegration;action:StaffAction;cleaners:ReturnType<typeof useEligibleCleaners>;taken:Set<string>;onClose:()=>void;onDone:()=>void}){
  const [reason,setReason]=useState('');const [replacement,setReplacement]=useState<Cleaner|null>(null);const mutation=useMutation();
  const cleaner=action.kind==='assign'?action.cleaner:action.kind==='reassign'?replacement:null;
  const title=action.kind==='assign'?`Assign ${action.cleaner.displayName}`:action.kind==='reassign'?`Reassign ${action.assignment.cleanerName}`:`Remove ${action.assignment.cleanerName}`;
  const ready=!!reason.trim()&&(action.kind==='remove'||!!cleaner);
  async function submit(event:FormEvent){event.preventDefault();if(!ready)return;const common={reason:reason.trim(),expectedVersion:job.version};
    const done=await mutation.run({job:job.id,kind:action.kind,cleaner:cleaner?.id,reason},key=>action.kind==='assign'?integration.admin!.assignJob!(job.id,{...common,cleanerId:action.cleaner.id},key):action.kind==='reassign'?request(`/admin/jobs/${encodeURIComponent(job.id)}/reassign`,{body:{...common,removeAssignmentId:action.assignment.id,cleanerId:cleaner!.id},key}):request(`/jobs/${encodeURIComponent(job.id)}/remove-assignment`,{body:{...common,assignmentId:action.assignment.id},key}));
    if(done)onDone();}
  return <Modal title={title} onClose={()=>{if(!mutation.busy)onClose();}}><form className="bloom-form bloom-staff-form" onSubmit={submit}>
    {action.kind==='remove'&&<p>The slot stays open for another cleaner.</p>}
    {action.kind==='reassign'&&<><p className="bloom-staff-label">Replacement cleaner</p><CleanerSearch cleaners={cleaners} exclude={taken} selectedId={replacement?.id} onPick={setReplacement}/></>}
    {cleaner&&<p className="bloom-staff-chosen"><span className="bloom-staff-avatar small"><CleanerAvatar name={cleaner.displayName} url={cleaner.avatarUrl}/></span>{cleaner.displayName}</p>}
    <label>Reason<textarea required value={reason} onChange={event=>setReason(event.target.value)} maxLength={1000}/></label>
    <Result mutation={mutation}/>
    <div className="bloom-actions"><button type="submit" className="bloom-button" disabled={mutation.busy||!ready}>{mutation.busy?'Saving…':action.kind==='assign'?'Assign':action.kind==='reassign'?'Reassign':'Remove'}</button><button type="button" className="bloom-button secondary" disabled={mutation.busy} onClick={onClose}>Cancel</button></div>
  </form></Modal>;
}
