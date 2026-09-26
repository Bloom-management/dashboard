import type {ComponentProps, CSSProperties} from 'react';
import './select.css';

const chevron = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27 fill=%27none%27%3E%3Cpath d=%27m4 6 4 4 4-4%27 stroke=%27%232d2a1f%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")';
const arrowStyle:CSSProperties={appearance:'none',WebkitAppearance:'none',backgroundImage:chevron,backgroundRepeat:'no-repeat',backgroundSize:'16px 16px',backgroundPosition:'right 16px center',paddingRight:48};
/** Native form behavior with one consistent, reserved chevron gutter across Bloom. */
export function Select({className='',style,multiple,size,...props}:ComponentProps<'select'>){
 const listbox=multiple||(size??0)>1;
 return <select {...props} multiple={multiple} size={size} className={`bloom-select ${className}`} style={{...style,...(!listbox?arrowStyle:{})}}/>;
}
