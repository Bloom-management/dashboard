import 'server-only';
import { userRpc } from '../db/rpc';
export const renameProperty = (propertyId:string,name:string,key:string) =>
 userRpc<{id:string;name:string}>('bloom_property_rename',{p_property:propertyId,p_name:name,p_key:key});
