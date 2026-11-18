import { response } from '../../../../server/db/http';
import { checkSchedule,dispatch,pushMode,pushRpc } from '../../../../server/push/runtime';
export const runtime='nodejs';export const maxDuration=60;
function tick(request:Request){return response(async()=>{checkSchedule(request);if(pushMode()==='off')return {disabled:true};await pushRpc('bloom_push_tick',{});return dispatch();});}
export const POST=tick;
/** Vercel Cron invokes scheduled paths with GET and `Authorization: Bearer $CRON_SECRET`. */
export const GET=tick;
