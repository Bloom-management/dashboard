/** Share two network slots across room photos, note attachments and retries. */
export function createPhotoUploadScheduler(limit=2){
 let active=0;
 const waiting:Array<()=>void>=[];
 function drain(){while(active<limit&&waiting.length){active++;waiting.shift()!();}}
 return <T>(task:()=>Promise<T>):Promise<T>=>new Promise<T>((resolve,reject)=>{
  waiting.push(()=>{void Promise.resolve().then(task).then(resolve,reject).finally(()=>{active--;drain();});});
  drain();
 });
}
export const schedulePhotoUpload=createPhotoUploadScheduler();
