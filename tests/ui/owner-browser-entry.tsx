// Isolated component fixture: the browser runner intercepts every API request.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {OwnerHub} from '../../src/components/bloom/owner';
import {request} from '../../src/components/bloom/api';
import '../../src/styles/bloom-owner.css';
import '../../src/styles/bloom-application.css';
createRoot(document.getElementById('root')!).render(<div className="bloom-owner app"><OwnerHub integration={{ownerProperties:signal=>request('/owner/properties',{signal}),ownerFreshness:signal=>request('/owner/freshness',{signal})}}/></div>);
