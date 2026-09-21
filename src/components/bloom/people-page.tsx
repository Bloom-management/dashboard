'use client';
import {useState,type ReactNode} from 'react';

/** Only the active ten rows are mounted; each table has independent navigation. */
export function PeoplePage<T>({items,label,children}:{items:T[];label:string;children:(page:T[])=>ReactNode}){
 const [requestedPage,setPage]=useState(0);
 const pages=Math.max(1,Math.ceil(items.length/10));
 const page=Math.min(requestedPage,pages-1);
 return <>{children(items.slice(page*10,page*10+10))}{pages>1&&<nav className="bloom-actions" aria-label={`${label} pages`}><button type="button" className="bloom-button secondary" disabled={page===0} onClick={()=>setPage(page-1)}>Previous page</button><span role="status">Page {page+1} of {pages}</span><button type="button" className="bloom-button secondary" disabled={page===pages-1} onClick={()=>setPage(page+1)}>Next page</button></nav>}</>;
}
