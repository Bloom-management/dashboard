export type InboxItem={id:string;body:string;href:string;dismissible:boolean;createdAt:string};
export type InboxPage={items:InboxItem[];total:number};
export async function mergeNotificationPage(offset:number,pending:InboxItem[],load:(offset:number)=>Promise<InboxPage>):Promise<InboxPage>{
 if(!pending.length)return load(offset);
 // Invitations can displace at most pending.length rows from the database page.
 const start=Math.max(0,offset-pending.length);const rows:InboxItem[]=[];let total=0;
 for(let cursor=start;cursor<offset+10;cursor+=10){
  const page=await load(cursor);rows.push(...page.items);total=page.total;
  if(cursor+page.items.length>=total)break;
 }
 const items=[...pending,...rows].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||(a.id<b.id?1:a.id>b.id?-1:0));
 return {items:items.slice(offset-start,offset-start+10),total:pending.length+total};
}
