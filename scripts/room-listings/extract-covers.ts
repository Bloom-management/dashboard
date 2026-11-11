import {writeFile} from 'node:fs/promises';
import {extractCover} from '../../src/server/properties/airbnb-cover';
const sources=[['DH2','1190187638631372725','DH2 - Private Room - 30 Day+'],['DH3','1190189243127995944','Spacious Queen - Safe - Homey (DH3)'],['DH4','1190172062840895435','DH4 - Private Room - Long Stay - 30 Day+'],['DH1','1190191672497242825','DH1 - Private Room (Shared bath) 30 day+']];
const results=[];
for(const [identifier,id,title] of sources){const url='https://www.airbnb.com/rooms/'+id;const image=await extractCover(url);results.push({identifier,url,title,image,status:image?'extracted':'unavailable',checkedAt:new Date().toISOString()});console.log(identifier,image?'extracted':'unavailable');}
// Repeated primary metadata across rooms is ambiguous; never substitute it.
for(const record of results){if(record.image&&results.some(other=>other!==record&&other.image===record.image)){Object.assign(record,{candidateImage:record.image});}}
for(const record of results){if('candidateImage' in record){record.image=null;record.status='unavailable';}}
await writeFile('scripts/room-listings/atam-covers.json',JSON.stringify(results,null,2)+'\n');
