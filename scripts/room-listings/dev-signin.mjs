/** Development preview helper; respects provider throttling without retrying other failures. */
export async function previewTicket(client,subject){
 for(let attempt=0;attempt<4;attempt++){
  try{return await client.signInTokens.createSignInToken({userId:subject,expiresInSeconds:90});}
  catch(error){if(error.status!==429||attempt===3)throw error;const delay=Math.min(60000,Math.max(1000,(Number(error.retryAfter)||5)*1000));await new Promise(resolve=>setTimeout(resolve,delay));}
 }
}
