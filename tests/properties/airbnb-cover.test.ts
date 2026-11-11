import assert from 'node:assert/strict';
import test from 'node:test';
import {listingUrl,coverUrl,extractCover} from '../../src/server/properties/airbnb-cover';
import {parseProduct} from '../../src/server/supplies/product-preview';

const listing='https://www.airbnb.com/rooms/1568588871312234223';
const image='https://a0.muscache.com/im/pictures/hosting/Hosting-1568588871312234223/original/d6cbebb5-dbdd-4fb8-8d1f-5e6594ee591f.jpeg?im_w=720';
test('canonical listing strips tracking and preserves the actual room ID',()=>{
 assert.equal(listingUrl(listing+'?source_impression_id=tracking&guests=2#photos'),listing);
 assert.equal(listingUrl(' https://m.airbnb.com/en-us/rooms/42/ '),'https://www.airbnb.com/rooms/42');
 assert.equal(listingUrl(''),null);assert.equal(listingUrl(null),null);
 for(const bad of ['https://airbnb.com.evil.test/rooms/42','http://www.airbnb.com/rooms/42','https://user@www.airbnb.com/rooms/42','https://www.airbnb.com:8443/rooms/42','https://127.0.0.1/rooms/42','https://www.airbnb.com/users/42','https://www.airbnb.com/rooms/42/photos','https://abnb.me/anything',42])assert.throws(()=>listingUrl(bad));
});
test('manual images accept only Airbnb image CDN URLs and use the same crop size',()=>{
 assert.equal(coverUrl(image+'&quality=70&auto=webp'),image);
 for(const bad of ['http://a0.muscache.com/pictures/a.jpg','https://a0.muscache.com.evil.test/pictures/a.jpg','https://user@a0.muscache.com/pictures/a.jpg','https://a0.muscache.com:8443/pictures/a.jpg','https://a0.muscache.com/arbitrary-path','data:image/jpeg;base64,AA','https://localhost/a.jpg'])assert.throws(()=>coverUrl(bad));
});
test('metadata extraction uses each listing’s cover rather than a static fallback',async()=>{
 const preview=async(url:string)=>parseProduct(`<meta property="og:image" content="${image.replaceAll('&','&amp;')}&amp;width=720&amp;quality=70">`,url);
 assert.equal(await extractCover(listing,preview),image);
 const other='https://a0.muscache.com/pictures/other-cover.jpg?im_w=720';
 assert.equal(await extractCover('https://www.airbnb.com/rooms/42',async(url)=>parseProduct(`<meta name='twitter:image' content='${other}'>`,url)),other);
});
test('blocked, missing and unsafe metadata return no image for the new listing',async()=>{
 for(const preview of [async()=>{throw new Error('HTTP 403');},async()=>({productName:'',imageUrl:null,costCents:null}),async()=>({productName:'',imageUrl:'http://127.0.0.1/internal',costCents:null})])assert.equal(await extractCover(listing,preview),null);
});
