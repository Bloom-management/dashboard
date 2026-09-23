import type {ComponentProps} from 'react';

/** Shared Bloom segmented selector. Use vt-btn and active on its option buttons. */
export function SelectorPill({className='',...props}:ComponentProps<'nav'>){
 return <nav {...props} className={`view-toggle bloom-selector-pill ${className}`}/>;
}
