import type {SupplyLevel} from '../../contracts';
import styles from './supply-level-bar.module.css';
/** Shared level indicator for current property stock and saved cleaning reports. */
export function SupplyLevelBar({level}:{level:SupplyLevel}){
 return <div className={styles.bar} data-level={level} aria-hidden="true"><span/></div>;
}
