import {response} from '../../../../server/db/http';
import {userRpc} from '../../../../server/db/rpc';
import {BackendError} from '../../../../server/db/errors';
import {notificationDate} from '../../../../contracts/push-navigation';
export async function GET(request:Request){return response(()=>{const date=notificationDate(new URL(request.url).searchParams.get('date'));if(!date)throw new BackendError('VALIDATION_ERROR');return userRpc('bloom_day_pins',{p_date:date});});}
