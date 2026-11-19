'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { useClerk, useUser } from '@clerk/nextjs';
import styles from './profile-menu.module.css';
import { APPEARANCE_EVENT, APPEARANCE_KEY, readAppearance, setAppearance, type Appearance } from '../theme/appearance';
export type { Appearance };

const svg = (children: ReactNode, size = 22) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const icons = {
  light: svg(<><circle cx="12" cy="12" r="3.6" /><path d="M12 2.8v1.9M12 19.3v1.9M4.7 4.7l1.4 1.4M17.9 17.9l1.4 1.4M2.8 12h1.9M19.3 12h1.9M4.7 19.3l1.4-1.4M17.9 6.1l1.4-1.4" /></>, 18),
  dark: svg(<path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6Z" />, 18),
  auto: svg(<><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></>, 18),
  account: svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3.2" /><path d="M6.3 18.4a6.6 6.6 0 0 1 11.4 0" /></>),
  bell: svg(<path d="M18 8.5a6 6 0 0 0-12 0c0 7-3 7.5-3 9h18c0-1.5-3-2-3-9M10 21h4" />),
  gallery: svg(<><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></>),
  signOut: svg(<><path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10" /><path d="m15 8 4 4-4 4M19 12H9.5" /></>),
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function ProfileAvatar({ name, imageUrl, className }: { name: string; imageUrl?: string | null; className: string }) {
  return <span className={className} aria-hidden="true">{imageUrl ? <img src={imageUrl} alt="" /> : initials(name)}</span>;
}

export type ProfileCardProps = {
  name: string; email: string; imageUrl?: string | null;
  appearance?: Appearance; onAppearance?: (value: Appearance) => void;
  onManageAccount: () => void; onNotifications: () => void; onSignOut: () => void;
  /** Admin hub only: link to the design gallery. */
  onDesignGallery?: () => void;
};

/** Account card: identity, optional appearance switch, account actions and sign out. */
export function ProfileCard({ name, email, imageUrl, appearance, onAppearance, onManageAccount, onNotifications, onSignOut, onDesignGallery }: ProfileCardProps) {
  return <>
    <div className={styles.identity}>
      <ProfileAvatar name={name} imageUrl={imageUrl} className={styles.avatar} />
      <div className={styles.names}><p className={styles.name}>{name}</p><p className={styles.email}>{email}</p></div>
    </div>
    {appearance && onAppearance && <>
      <hr className={styles.divider} />
      <p className={styles.label} id="bloom-appearance-label">Appearance</p>
      <div className={styles.segments} role="radiogroup" aria-labelledby="bloom-appearance-label">
        {(['light', 'dark', 'auto'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={appearance === value} className={styles.segment} onClick={() => onAppearance(value)}>{icons[value]}{value === 'light' ? 'Light' : value === 'dark' ? 'Dark' : 'Auto'}</button>)}
      </div>
    </>}
    <hr className={styles.divider} />
    <div className={styles.actions}>
      <button type="button" className={styles.item} onClick={onManageAccount}>{icons.account}Manage account</button>
      <button type="button" className={styles.item} onClick={onNotifications}>{icons.bell}Notifications</button>
      {onDesignGallery && <button type="button" className={styles.item} onClick={onDesignGallery}>{icons.gallery}Design gallery</button>}
    </div>
    <hr className={styles.divider} />
    <div className={styles.actions}>
      <button type="button" className={`${styles.item} ${styles.danger}`} onClick={onSignOut}>{icons.signOut}Sign out</button>
    </div>
    <p className={styles.footer}>Secured by Clerk</p>
  </>;
}

/** Static card surface for previews (the live menu renders the same surface inside a popover). */
export function ProfileCardSurface(props: ProfileCardProps) {
  return <div className={styles.card}><ProfileCard {...props} /></div>;
}

/** Header account control: avatar trigger opening the Bloom profile card. Clerk supplies identity and actions. */
export function ProfileMenu({ designGallery = false }: { designGallery?: boolean }) {
  const { user } = useUser();
  const clerk = useClerk();
  const [open, setOpen] = useState(false);
  const [appearance, setChoice] = useState<Appearance>('auto');
  useEffect(() => {
    setChoice(readAppearance());
    const sync = () => setChoice(readAppearance());
    const onStorage = (event: StorageEvent) => { if (event.key === APPEARANCE_KEY) sync(); };
    window.addEventListener(APPEARANCE_EVENT, sync); window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(APPEARANCE_EVENT, sync); window.removeEventListener('storage', onStorage); };
  }, []);
  if (!user) return null;
  const name = user.fullName || user.username || user.primaryEmailAddress?.emailAddress || 'Your account';
  const email = user.primaryEmailAddress?.emailAddress ?? '';
  const imageUrl = user.hasImage ? user.imageUrl : null;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger className={styles.trigger} aria-label={`Account: ${name}`}><ProfileAvatar name={name} imageUrl={imageUrl} className="" /></Popover.Trigger>
    <Popover.Portal><Popover.Positioner sideOffset={10} align="end" collisionPadding={12} style={{ zIndex: 100 }}>
      <Popover.Popup className={styles.card} aria-label="Account">
        <ProfileCard name={name} email={email} imageUrl={imageUrl}
          appearance={appearance} onAppearance={value => { setChoice(value); setAppearance(value); }}
          onManageAccount={() => { setOpen(false); clerk.openUserProfile(); }}
          onNotifications={() => { setOpen(false); window.dispatchEvent(new Event('bloom:notification-settings')); }}
          onSignOut={() => { setOpen(false); void clerk.signOut({ redirectUrl: '/sign-in' }); }}
          onDesignGallery={designGallery ? () => { setOpen(false); window.location.assign('/design'); } : undefined} />
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
