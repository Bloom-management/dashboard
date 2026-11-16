'use client';
import {useRef,useState,type ReactNode} from 'react';
import {ErrorNotice,Modal} from './primitives';
import {IconButton} from './icon-button';
import styles from './removable-item.module.css';

/**
 * Wraps a grid card with a remove (trash) button that appears on hover or keyboard focus,
 * and asks for confirmation in the shared dialog before calling `onRemove`.
 */
export function RemovableItem({name,kind,onRemove,enabled=true,children}:{name:string;kind:string;onRemove:()=>Promise<void>;enabled?:boolean;children:ReactNode}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();const lock=useRef(false);
 async function remove(){
  if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
  try{await onRemove();setConfirm(false);}catch(failure){setError(failure);}finally{lock.current=false;setBusy(false);}
 }
 return <div className={styles.cell}>{children}{enabled&&<IconButton icon="trash" size="md" variant="outline" iconSize={16} className={styles.remove} label={`Remove ${name}`} title={`Remove ${name}`} onClick={()=>{setError(undefined);setConfirm(true);}}/>}{confirm&&<Modal title={`Remove ${name}?`} onClose={()=>{if(!busy)setConfirm(false);}}><p className={styles.message}>This removes the {kind} “{name}” from this listing. Cleaners will no longer report on it.</p><div className={styles.actions}><button type="button" className="bloom-button" disabled={busy} onClick={()=>void remove()}>{busy?'Removing…':`Remove ${kind}`}</button><button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>setConfirm(false)}>Keep {kind}</button></div>{error!=null&&<ErrorNotice error={error}/>}</Modal>}</div>;
}
