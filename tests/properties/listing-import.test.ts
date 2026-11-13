import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseListing,listingSuggestions} from '../../src/server/properties/listing-import';
const amenity=(title:string,available=true)=>`{"__typename":"AmenityItem","available":${available},"title":"${title}","icon":"X"}`;
const page=(summary:string,extra='')=>`<meta property="og:title" content="${summary}"/><meta property="og:description" content="2BR Townhome &amp; EV charging"/><meta property="og:image" content="https://a0.muscache.com/im/pictures/hosting/a.jpeg?im_w=720&amp;width=720"/>${extra}`;
test('listing import reads title, cover, rooms and available amenities',()=>{
 const result=parseListing(page('Townhouse in Detroit · ★4.98 · 2 bedrooms · 3 beds · 2.5 baths',amenity('Dishwasher')+amenity('Free washer – In unit')+amenity('Hair dryer')+amenity('Pool',false)),'https://www.airbnb.com/rooms/1');
 assert.equal(result.title,'2BR Townhome & EV charging');
 assert.equal(result.kind,'entire_home');assert.equal(result.bedrooms,2);assert.equal(result.bathrooms,3);
 assert.equal(result.image,'https://a0.muscache.com/im/pictures/hosting/a.jpeg?im_w=720');assert.equal(result.status,'extracted');
 assert.deepEqual(result.amenities,['Dishwasher','Free washer – In unit','Hair dryer']);
 assert.ok(result.supplies.includes('Dishwasher pods')&&result.supplies.includes('Laundry detergent')&&!result.supplies.includes('Dryer sheets'));
 assert.ok(result.maintenance.includes('Washer')&&result.maintenance.includes('Dishwasher')&&!result.maintenance.includes('Pool')&&!result.maintenance.includes('Dryer'));
});
test('listing import detects rooms and studios and always suggests basics',()=>{
 assert.equal(parseListing(page('Private room in Dearborn Heights · 1 bedroom · 1 shared bath'),'https://www.airbnb.com/rooms/2').kind,'room');
 assert.equal(parseListing(page('Rental unit in Detroit · Studio · 1 bed · 1 bath'),'https://www.airbnb.com/rooms/3').bedrooms,0);
 const empty=parseListing('<html></html>','https://www.airbnb.com/rooms/4');
 assert.equal(empty.kind,null);assert.equal(empty.image,null);assert.equal(empty.status,'unavailable');
 assert.ok(listingSuggestions([]).supplies.includes('Toilet paper'));
 assert.deepEqual(listingSuggestions(['Dishwasher']).maintenance,['Dishwasher']);
});
test('listing import trusts roomType over the "Home in" title and suggests room cleaning steps',()=>{
 const room=parseListing(page('Home in Dearborn Heights · ★4.88 · 1 bedroom · 1 bed · 1 shared bath','"roomType":"Private room"'+amenity('Dishwasher')),'https://www.airbnb.com/rooms/5');
 assert.equal(room.kind,'room');
 assert.ok(room.instructions[0].startsWith('Clean only this room'));
 assert.ok(room.instructions.includes('Clean the shared bathroom after the room is done.'));
 assert.ok(room.instructions.includes('Run the dishwasher if it has dirty dishes, and put away clean ones.'));
 assert.ok(!room.instructions.includes('Vacuum and mop all floors.'));
 const home=parseListing(page('Home in Detroit · 2 bedrooms · 1 bath','"roomType":"Entire home/apt"'),'https://www.airbnb.com/rooms/6');
 assert.equal(home.kind,'entire_home');assert.ok(home.instructions.includes('Vacuum and mop all floors.'));
 assert.ok(!home.instructions.some(l=>l.includes('this room')));
});
