import { response } from '../../../../server/db/http';
import { checkSchedule,dispatch,pushMode,pushRpc } from '../../../../server/push/runtime';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(request:Request){return response(async()=>{checkSchedule(request);if(pushMode()==='off')return {disabled:true};await pushRpc('bloom_push_tick',{});return dispatch();});}
