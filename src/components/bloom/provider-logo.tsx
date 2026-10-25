import Image from 'next/image';
import styles from './provider-logo.module.css';
export function ProviderLogo({provider}:{provider:'airbnb'|'vrbo'}){
 return <span className={styles.frame}><Image className={provider==='vrbo'?styles.vrbo:styles.airbnb} src={provider==='vrbo'?'/images/booking-sources/vrbo-transparent.png':'/images/booking-sources/airbnb.jpg'} width={provider==='vrbo'?1983:1200} height={provider==='vrbo'?793:1200} alt={provider==='vrbo'?'Vrbo':'Airbnb'}/></span>;
}
