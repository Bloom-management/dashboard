'use client';
import {useState,type FormEvent} from 'react';
import type {CleanerJob} from '../../contracts';
import type {BloomIntegration} from './integration';
import {request} from './api';
import {ErrorNotice,Icon,Loading,Modal,type useResource} from './primitives';
import {CleanerAvatar} from './cleaner-identity';
import {DropdownMenu,DropdownMenuContent,DropdownMenuGroup,DropdownMenuItem,DropdownMenuTrigger} from '../ui/dropdown-menu';
import {Paginated,Result,useMutation} from './admin-shared';

type StaffAssignment={id:string;cleanerId?:string;cleanerName:string;avatarUrl?:string|null};
type StaffAction={kind:'assign'}|{kind:'reassign'|'remove';assignment:StaffAssignment};
const chevronDown=<svg className="bloom-staff-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
/** "Who's working": one slot per seat. Assigned slots open Reassign / Remove; open slots open Assign. */
export function JobStaffing({job,integration,assignments,onChanged}:{job:CleanerJob;integration:BloomIntegration;assignments:ReturnType<typeof useResource<StaffAssignment[]|null>>;onChanged:()=>void}){
  const [action,setAction]=useState<StaffAction|null>(null);
  const assigned=assignments.data??[];
  const seats=Math.max(job.capacity??2,assigned.length);
  return <section className="bloom-admin-card bloom-staffing" aria-label="Who's working"><div className="bloom-staffing-head"><h3>Who&apos;s working</h3><span>{assigned.length} of {seats}</span></div>
    {assignments.loading&&!assignments.data?<Loading/>:assignments.error?<ErrorNotice error={assignments.error} retry={assignments.reload}/>:<ul className="bloom-staff-slots">{Array.from({length:seats},(_,index)=>{const person=assigned[index];return <li key={person?.id??`open-${index}`}><DropdownMenu><DropdownMenuTrigger className={`bloom-staff-slot${person?'':' open'}`} aria-label={person?`${person.cleanerName}: reassign or remove`:'Open slot: assign a cleaner'}>
      {person?<span className="bloom-staff-avatar"><CleanerAvatar name={person.cleanerName} url={person.avatarUrl}/></span>:<span className="bloom-staff-avatar open" aria-hidden="true"><Icon name="plus" size={18}/></span>}
      <span className="bloom-staff-text"><strong>{person?person.cleanerName:'Open slot'}</strong><span>{person?'Assigned':'No cleaner yet'}</span></span>{chevronDown}
    </DropdownMenuTrigger><DropdownMenuContent><DropdownMenuGroup>{person?<><DropdownMenuItem onClick={()=>setAction({kind:'reassign',assignment:person})}>Reassign</DropdownMenuItem><DropdownMenuItem onClick={()=>setAction({kind:'remove',assignment:person})}>Remove</DropdownMenuItem></>:<DropdownMenuItem disabled={!integration.admin?.assignJob} onClick={()=>setAction({kind:'assign'})}>Assign</DropdownMenuItem>}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu></li>;})}</ul>}
    {action&&<StaffActionDialog job={job} integration={integration} action={action} assigned={assigned} onClose={()=>setAction(null)} onDone={()=>{setAction(null);assignments.reload();onChanged();}}/>}
  </section>;
}
function StaffActionDialog({job,integration,action,assigned,onClose,onDone}:{job:CleanerJob;integration:BloomIntegration;action:StaffAction;assigned:StaffAssignment[];onClose:()=>void;onDone:()=>void}){
  const [reason,setReason]=useState('');const [cleanerId,setCleanerId]=useState('');const mutation=useMutation();
  const picking=action.kind!=='remove';
  const title=action.kind==='assign'?'Assign a cleaner':action.kind==='reassign'?`Reassign ${action.assignment.cleanerName}`:`Remove ${action.assignment.cleanerName}`;
  async function submit(event:FormEvent){event.preventDefault();const common={reason:reason.trim(),expectedVersion:job.version};if(!common.reason||(picking&&!cleanerId))return;
    const done=await mutation.run({job:job.id,action,cleanerId,reason},key=>action.kind==='assign'?integration.admin!.assignJob!(job.id,{...common,cleanerId},key):action.kind==='reassign'?request(`/admin/jobs/${encodeURIComponent(job.id)}/reassign`,{body:{...common,removeAssignmentId:action.assignment.id,cleanerId},key}):request(`/jobs/${encodeURIComponent(job.id)}/remove-assignment`,{body:{...common,assignmentId:action.assignment.id},key}));
    if(done)onDone();}
  // Match by account id: different people can share a display name.
  const taken=new Set(assigned.flatMap(item=>item.cleanerId?[item.cleanerId]:[]));
  return <Modal title={title} onClose={()=>{if(!mutation.busy)onClose();}}><form className="bloom-form bloom-staff-form" onSubmit={submit}>
    {action.kind==='remove'&&<p>The slot stays open for another cleaner.</p>}
    {picking&&integration.admin&&<Paginated loader={integration.admin.users} render={users=><fieldset className="bloom-staff-options"><legend>Cleaner</legend>{users.filter(item=>(item.role==='admin'||(item.role==='cleaner'&&item.approvedCityId===job.cityId))&&!taken.has(item.id)).map(cleaner=><label className="bloom-staff-option" key={cleaner.id}><input type="radio" name="staff-cleaner" checked={cleanerId===cleaner.id} onChange={()=>setCleanerId(cleaner.id)}/><span className="bloom-staff-avatar"><CleanerAvatar name={cleaner.displayName} url={cleaner.avatarUrl}/></span><span>{cleaner.displayName}</span></label>)}</fieldset>}/>}
    <label>Reason<textarea required value={reason} onChange={event=>setReason(event.target.value)} maxLength={1000}/></label>
    <Result mutation={mutation}/>
    <div className="bloom-actions"><button type="submit" className="bloom-button" disabled={mutation.busy||!reason.trim()||(picking&&!cleanerId)}>{mutation.busy?'Saving…':action.kind==='assign'?'Assign':action.kind==='reassign'?'Reassign':'Remove'}</button><button type="button" className="bloom-button secondary" disabled={mutation.busy} onClick={onClose}>Cancel</button></div>
  </form></Modal>;
}
