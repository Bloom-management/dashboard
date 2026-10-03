export function notificationDate(value:unknown):string|null{
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
}
/** Navigation hints only, never permission/role/city authorization. */
export function cleanerDestination(input:Record<string,unknown>){const q=new URLSearchParams();if(input.view==='upcoming'||input.view==='calendar'||input.view==='payouts')q.set('view',input.view);const date=notificationDate(input.date);if(date)q.set('date',date);if(typeof input.city==='string'&&/^[a-f\d-]{36}$/i.test(input.city))q.set('city',input.city);if(input.notifications==='1')q.set('notifications','1');return '/cleaner'+(q.size?'?'+q:'');}

export function activityDestination(role:'owner'|'admin',input:Record<string,unknown>){
 const q=new URLSearchParams();
 if(input.view==='activity'){q.set('view','activity');if(typeof input.job==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(input.job))q.set('job',input.job);}
 if(input.notifications==='1')q.set('notifications','1');
 return '/'+role+(q.size?'?'+q:'');
}
