import {BloomFlower} from './startup/bloom-flower';
/** Local loading feedback: never covers the back control or delays ready content. */
export function DialogLoading(){return <div className="bloom-dialog-loading" role="status" aria-label="Loading cleaning details"><BloomFlower/></div>;}
