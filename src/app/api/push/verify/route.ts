/** Expired legacy proof links cannot establish new registrations. */
export async function POST(){return Response.json({error:{code:'NOT_FOUND',message:'Open notification settings to enable this device.'}},{status:410,headers:{'Cache-Control':'no-store'}});}
