import {ButtonContent} from './button-content';
import {Icon} from './primitives';
import styles from './add-card.module.css';

/** Dashed "+ Add …" card that ends an item grid and fills one grid cell like its sibling cards. */
export function AddCard({label,onClick,disabled=false,expanded}:{label:string;onClick:()=>void;disabled?:boolean;expanded?:boolean}){
 return <button type="button" className={styles.card} disabled={disabled} aria-expanded={expanded} onClick={onClick}><ButtonContent icon={<Icon name="plus" size={22}/>}>{label}</ButtonContent></button>;
}
