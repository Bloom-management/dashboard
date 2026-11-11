import { response } from '../../../../server/db/http';
import { requireAdmin } from '../../../../server/auth/session';
import { pushRpc,pushMode,nativeEnabled } from '../../../../server/push/runtime';
import {nativeReady} from '../../../../server/push/native';
export async function GET(){return response(async()=>{await requireAdmin();return {mode:pushMode(),enrollmentTransport:nativeEnabled()?'native':'onesignal',nativeConfigured:nativeReady(),legacyConfigured:!!process.env.ONESIGNAL_APP_ID&&!!process.env.ONESIGNAL_REST_API_KEY,health:await pushRpc('bloom_push_health',{}),deliveries:await pushRpc('bloom_push_history',{})};});}
