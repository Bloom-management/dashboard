import { response } from '../../../../server/db/http';
import { requireAdmin } from '../../../../server/auth/session';
import { pushRpc,pushMode } from '../../../../server/push/runtime';
export async function GET(){return response(async()=>{await requireAdmin();return {mode:pushMode(),health:await pushRpc('bloom_push_health',{}),deliveries:await pushRpc('bloom_push_history',{})};});}
