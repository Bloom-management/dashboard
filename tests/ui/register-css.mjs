// Supply module class names for Node render tests; Next/Chrome verifies real CSS.
import { register } from 'node:module';
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url, context, nextLoad) {
 if (url.endsWith('.module.css')) return {format:'module',shortCircuit:true,source:'export default new Proxy({}, {get: (_, name) => String(name)});'};
 return nextLoad(url,context);
}`)}`, import.meta.url);
