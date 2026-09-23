import {test} from 'node:test';import assert from 'node:assert/strict';
import {groupPoints,validPin} from '../../src/components/maps/points';
test('pins reject invalid numbers and unsupported latitude, preserving valid zero coordinates',()=>{assert(validPin({latitude:0,longitude:0}));for(const latitude of [NaN,Infinity,90,-90])assert(!validPin({latitude,longitude:0}));assert(!validPin({latitude:42,longitude:181}));});
test('co-located units share a marker without losing job identities or merging nearby addresses',()=>{const p={latitude:42,longitude:-83,label:'Unit'};const groups=groupPoints([{...p,id:'a'},{...p,id:'b'},{...p,id:'c',latitude:42.00001}]);assert.deepEqual(groups.map(g=>g.map(p=>p.id)),[['a','b'],['c']]);});
