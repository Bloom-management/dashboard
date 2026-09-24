'use client';
import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {BloomFlower} from './bloom-flower';
import styles from './startup.module.css';
type Resource={loading:boolean;error?:unknown};
type Tracker=(id:symbol,state:Resource|null)=>void;
const StartupContext=createContext<Tracker|null>(null);
// A document launch only: hub navigation and later refreshes never replay the splash.
let launchFinished=false;
export function StartupBoundary({children}:{children:ReactNode}){
 const [active,setActive]=useState(()=>!launchFinished);
 const [mode,setMode]=useState<'once'|'loop'>('loop');
 const resources=useRef(new Map<symbol,Resource>());
 const [revision,setRevision]=useState(0);
 const track=useCallback<Tracker>((id,state)=>{if(state)resources.current.set(id,state);else resources.current.delete(id);setRevision(n=>n+1);},[]);
 useLayoutEffect(()=>{setMode(matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone?'once':'loop');},[]);
 useEffect(()=>{
  const states=[...resources.current.values()];
  if(active&&states.length&&(states.some(s=>s.error)||states.every(s=>!s.loading))){launchFinished=true;setActive(false);}
 },[active,revision]);
 return <StartupContext.Provider value={active?track:null}><div className={active?styles.pending:undefined} aria-hidden={active||undefined}>{children}</div>{active&&<div className={styles.screen} role="status" aria-label="Loading Bloom" aria-busy="true"><BloomFlower mode={mode}/></div>}</StartupContext.Provider>;
}
/** Track foreground initial requests only; layout registration precedes readiness evaluation. */
export function useStartupResource(state:Resource){
 const track=useContext(StartupContext);const id=useRef(Symbol('startup resource'));
 useLayoutEffect(()=>{track?.(id.current,state);},[track,state.loading,state.error]);
 useLayoutEffect(()=>{const key=id.current;return()=>track?.(key,null);},[track]);
}
