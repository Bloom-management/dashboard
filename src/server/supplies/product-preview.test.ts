import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseProduct} from './product-preview';
import {productUrl,validatePurchase} from './validation';
test('preview extracts product details without inventing a paid price',()=>{
 assert.deepEqual(parseProduct('<meta property="og:title" content="Soap &amp; refill"><meta content="/soap.jpg" property="og:image"><meta property="product:price:amount" content="12.99"><meta property="product:price:currency" content="USD">','https://example.com/item'),{productName:'Soap & refill',imageUrl:'https://example.com/soap.jpg',costCents:1299});
 assert.equal(parseProduct('<meta property="product:price:amount" content="12.99">','https://example.com').costCents,null);
 assert.equal(parseProduct('<meta property="og:image" content="javascript:alert(1)">','https://example.com').imageUrl,null);
});
test('purchase validation rejects invalid costs, dates and unsafe links',()=>{
 const valid={productName:'Soap',costCents:1200,purchaseDate:'2026-10-10',restockedDate:null,productUrl:null,imageUrl:null};
 validatePurchase(valid);
 for(const changed of [{costCents:-1},{costCents:1.5},{purchaseDate:'2026-02-30'},{productUrl:'javascript:alert(1)'},{imageUrl:'http://example.com/a.jpg'}])assert.throws(()=>validatePurchase({...valid,...changed}));
 for(const url of ['https://localhost/a','https://test.local/a','https://user:pass@example.com/a'])assert.throws(()=>productUrl(url));
});
