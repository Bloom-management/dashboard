import type {ReactNode} from 'react';
import styles from './button-content.module.css';

/** Centered button labels with a fixed gap for optional leading/trailing icons. */
export function ButtonContent({children,icon}:{children:ReactNode;icon?:ReactNode}) {
 return <span className={styles.content}><span className={styles.label}>{children}</span>{icon&&<span className={styles.icon} aria-hidden="true">{icon}</span>}</span>;
}
