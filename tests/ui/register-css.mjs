// Supply module class names for Node render tests; Next/Chrome verifies real CSS.
import { register } from 'node:module';
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url, context, nextLoad) {
 if (url.endsWith('/next/image.js')) return {format:'module',shortCircuit:true,source:'import React from '+JSON.stringify(${JSON.stringify(import.meta.resolve('react'))})+'; export default function Image(props){return React.createElement("img",props);}'};
 if (url.endsWith('.module.css')) return {format:'module',shortCircuit:true,source:'export default new Proxy({}, {get: (_, name) => String(name)});'};
 if (url.endsWith('.css')) return {format:'module',shortCircuit:true,source:'export default {};'};
 return nextLoad(url,context);
}`)}`, import.meta.url);
