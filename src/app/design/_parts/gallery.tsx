'use client';
/* Design gallery (admins only): every shared Bloom component on one scrollable page. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/nextjs';
import { APPEARANCE_EVENT, APPEARANCE_KEY, readAppearance, resolveAppearance, setAppearance } from '../../../components/theme/appearance';
type DesignTheme = 'light' | 'dark';
import { jobs } from './fixtures';
import { Brand, Changes, Empty, ErrorNotice, Icon, Loading, type IconName } from '../../../components/bloom/primitives';
import { IconButton } from '../../../components/bloom/icon-button';
import { OutlineButton } from '../../../components/bloom/outline-button';
import { ButtonContent } from '../../../components/bloom/button-content';
import { BackButton } from '../../../components/bloom/back-button';
import { SelectorPill } from '../../../components/bloom/selector-pill';
import { SupplyLevelBar } from '../../../components/bloom/supply-level-bar';
import { GuestStars } from '../../../components/bloom/guest-stars';
import { ProviderLogo } from '../../../components/bloom/provider-logo';
import { PersonAvatar } from '../../../components/bloom/person-avatar';
import { CheckInNote, CheckInTile, CleaningWindow } from '../../../components/bloom/check-in';
import { ApiError } from '../../../components/bloom/api';
import { Select } from '../../../components/ui/select';
import { Input } from '../../../components/ui/input';
import { Calendar } from '../../../components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import { ProfileAvatar, ProfileCardSurface, type Appearance } from '../../../components/bloom/profile-menu';

const icons: IconName[] = ['grid', 'list', 'left', 'right', 'close', 'plus', 'minus', 'pin', 'house', 'trash', 'arrow-left', 'arrow-right', 'arrow-up-right', 'door'];

const current = [
  ['--cream', '#f6f3ec'], ['--cream-2', '#efebe1'], ['--card', '#ffffff'], ['--ink', '#2d2a1f'], ['--ink-2', '#4a4538'], ['--muted', '#8a8270'], ['--muted-2', '#a8a08c'],
  ['--olive', '#7a7050'], ['--sand', '#c9bd9e'], ['--bloom', '#d97a85'], ['--bloom-soft', '#f7dde4'], ['--bloom-deep', '#b85563'], ['--gray-fill', '#ececec'], ['--gray-stack', '#e7e3da'],
];
const proposed: [string, string, string][] = [
  ['--bg', '#FAF7F5', '#141012'], ['--surface', '#FFFFFF', '#1D181B'], ['--surface-inset', '#F5F0EE', '#262024'], ['--border', '#E9E1DE', '#352D31'], ['--border-strong', '#D6CBC7', '#4A4045'],
  ['--ink', '#221B1E', '#F6EFF1'], ['--ink-2', '#5C5156', '#C2B6BB'], ['--ink-3', '#716569', '#968A90'],
  ['--pink', '#E58FAA', '#F29BB7'], ['--pink-ink', '#A8405F', '#F5A3BD'], ['--pink-tint', '#FCEEF2', '#3A2230'], ['--primary', '#2A1F24', '#F6EFF1'],
  ['--success-ink', '#2F6A40', '#8FD19E'], ['--yellow-line', '#E0B020', '#E0B020'], ['--orange-line', '#E8742A', '#F08A45'], ['--danger-ink', '#B3263E', '#F59AAA'],
];

const sections = ['Palette', 'Profile card', 'Brand & icons', 'Buttons', 'Form controls', 'Calendar', 'Status', 'Check-in', 'Claim cards', 'Claim dialog', 'Cleaning journey', 'Cleaner screen', 'Add listing · entire', 'Add listing · shared', 'Add listing · admin', 'Owner screens', 'Admin screens', 'Live screens'];
const slug = (label: string) => label.toLowerCase().replace(/[^a-z]+/g, '-');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section id={slug(title)} style={{ padding: '40px 0', borderTop: '1px solid var(--line)' }}><h2 style={{ margin: '0 0 20px', fontSize: 24 }}>{title}</h2>{children}</section>;
}
function Specimen({ label, children, width }: { label: string; children: ReactNode; width?: number }) {
  return <figure style={{ margin: 0, display: 'grid', gap: 10, alignContent: 'start', width }}><figcaption style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>{label}</figcaption><div>{children}</div></figure>;
}
const row = { display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' } as const;

const entireSteps = ['Import and address', 'Listing type', 'Rooms', 'Supplies', 'Maintenance', 'Access', 'Calendar'];
const sharedSteps = ['Import and address', 'Listing type', 'Room details'];
const ownerViews: [string, string][] = [['payouts', 'Payouts'], ['calendar', 'Calendar'], ['performance', 'Performance'], ['listings', 'Listings'], ['people', 'People'], ['activity', 'Activity']];
const adminViews: [string, string][] = [['payouts', 'Payouts'], ['jobs', 'Calendar'], ['properties', 'Properties'], ['users', 'People'], ['activity', 'Activity'], ['cities', 'Cities'], ['requests', 'Requests']];

const SessionContext = createContext('signed-out');

/** A real page in an iframe, scaled to fit. Each frame runs the app's ThemeController, so it follows the appearance setting. */
function Frame({ src, width, height, scale = 1, label }: { src: string; width: number; height: number; scale?: number; label: string }) {
  const [key, setKey] = useState(0);
  const session = useContext(SessionContext);
  const frame = useRef<HTMLIFrameElement>(null);
  return <Specimen label={`${label} · ${width}px`}><div style={{ display: 'flex', gap: 12, marginBottom: 6 }}><a href={src} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--bloom-deep)' }}>Open</a><button type="button" style={{ fontSize: 13, border: 0, background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'var(--ink-2)' }} onClick={() => setKey(value => value + 1)}>Reload</button></div><div style={{ width: width * scale, height: height * scale, overflow: 'hidden', borderRadius: 18, boxShadow: '0 0 0 1px var(--line-2), var(--shadow-md)', background: 'var(--card)' }}><iframe ref={frame} key={`${key}:${session}`} title={label} src={src} loading="lazy" style={{ width, height, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', background: 'var(--card)' }} /></div></Specimen>;
}
function PhoneAndDesktop({ src, label, height = 820 }: { src: string; label: string; height?: number }) {
  return <div style={row}><Frame src={src} label={`${label} — phone`} width={390} height={height} /><Frame src={src} label={`${label} — desktop`} width={1280} height={height} scale={0.5} /></div>;
}

/** The profile card forced to one theme, with the signed-in account when available. */
function ProfileSpecimen({ theme }: { theme: 'light' | 'dark' }) {
  const { user } = useUser();
  const [appearance, setAppearance] = useState<Appearance>(theme);
  const name = user?.fullName || 'Pierre Harbin';
  const email = user?.primaryEmailAddress?.emailAddress ?? 'pierre@bloomhub.co';
  const imageUrl = user?.hasImage ? user.imageUrl : null;
  return <Specimen label={`ProfileMenu · ${theme}`}>
    <div data-theme={theme} style={{ padding: 28, borderRadius: 24, background: theme === 'dark' ? '#141012' : '#FAF7F5', display: 'grid', gap: 14, justifyItems: 'end' }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', background: theme === 'dark' ? '#3A2230' : '#FCEEF2', color: theme === 'dark' ? '#F5A3BD' : '#A8405F', fontWeight: 600, fontSize: 13 }}><ProfileAvatar name={name} imageUrl={imageUrl} className="" /></span>
      <ProfileCardSurface name={name} email={email} imageUrl={imageUrl} appearance={appearance} onAppearance={setAppearance} onManageAccount={() => {}} onNotifications={() => {}} onSignOut={() => {}} />
    </div>
  </Specimen>;
}

function SessionBar() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  if (!isLoaded) return <span style={{ fontSize: 13, color: 'var(--muted)' }}>Checking session…</span>;
  if (!isSignedIn) return <a className="bloom-button" style={{ minHeight: 34, padding: '6px 14px', fontSize: 13 }} href="/sign-in?redirect_url=%2Fdesign">Sign in for live screens</a>;
  return <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'var(--ink-2)' }}>Signed in as {user?.fullName ?? user?.primaryEmailAddress?.emailAddress}<button type="button" className="bloom-button secondary" style={{ minHeight: 34, padding: '6px 14px', fontSize: 13 }} onClick={() => void clerk.signOut({ redirectUrl: '/design' })}>Sign out</button></span>;
}

function ThemeToggle({ theme, onChange }: { theme: DesignTheme; onChange: (theme: DesignTheme) => void }) {
  return <SelectorPill aria-label="Preview theme" style={{ flexShrink: 0 }}>{(['light', 'dark'] as const).map(value => <button key={value} type="button" className={`vt-btn${theme === value ? ' active' : ''}`} aria-pressed={theme === value} onClick={() => onChange(value)}>{value === 'light' ? 'Light' : 'Dark'}</button>)}</SelectorPill>;
}

export function DesignGallery() {
  const [theme, setTheme] = useState<DesignTheme>('light');
  useEffect(() => {
    const sync = () => setTheme(resolveAppearance(readAppearance()));
    const onStorage = (event: StorageEvent) => { if (event.key === APPEARANCE_KEY) sync(); };
    sync();
    window.addEventListener(APPEARANCE_EVENT, sync); window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(APPEARANCE_EVENT, sync); window.removeEventListener('storage', onStorage); };
  }, []);
  const { userId } = useAuth();
  const [view, setView] = useState('calendar');
  const [stars, setStars] = useState(4);
  const [day, setDay] = useState<Date | undefined>(new Date());
  const [range, setRange] = useState<DateRange | undefined>({ from: new Date(), to: new Date(Date.now() + 3 * 86400000) });
  return <SessionContext.Provider value={userId ?? 'signed-out'}><div className="bloom-cleaner" style={{ minHeight: '100vh' }}>
    <nav style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '12px 32px', background: 'color-mix(in srgb, var(--cream) 92%, transparent)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--line)' }}>
      <strong style={{ marginRight: 12 }}>Bloom design gallery</strong>
      {sections.map(label => <a key={label} href={`#${slug(label)}`} style={{ fontSize: 13, padding: '6px 10px', borderRadius: 999, background: 'var(--card)', color: 'var(--ink-2)', textDecoration: 'none', boxShadow: 'inset 0 0 0 1px var(--line)' }}>{label}</a>)}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 14, alignItems: 'center' }}><SessionBar /><ThemeToggle theme={theme} onChange={value => setAppearance(value)} /></span>
    </nav>
    <main style={{ padding: '0 32px 120px', maxWidth: 1480, margin: '0 auto' }}>

      <Section title="Palette">
        <h3>Current (.bloom-cleaner tokens)</h3>
        <div style={row}>{current.map(([name, hex]) => <Specimen key={name} label={name}><div style={{ width: 96, height: 56, borderRadius: 12, background: hex, boxShadow: 'inset 0 0 0 1px var(--line-2)' }} /><code style={{ fontSize: 12 }}>{hex}</code></Specimen>)}</div>
        <h3 style={{ marginTop: 32 }}>Proposed — warm white / plum night</h3>
        <div style={row}>{proposed.map(([name, light, dark]) => <Specimen key={name} label={name}><div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--line-2)' }}><div style={{ width: 56, height: 56, background: light }} /><div style={{ width: 56, height: 56, background: dark }} /></div><code style={{ fontSize: 12 }}>{light} · {dark}</code></Specimen>)}</div>
      </Section>

      <Section title="Profile card">
        <div style={row}>
          <ProfileSpecimen theme="light" />
          <ProfileSpecimen theme="dark" />
        </div>
      </Section>

      <Section title="Brand & icons">
        <div style={row}><Specimen label="Brand role=cleaner"><Brand role="cleaner" /></Specimen><Specimen label="Brand role=owner"><Brand role="owner" /></Specimen><Specimen label="Brand role=admin"><Brand role="admin" /></Specimen></div>
        <div style={{ ...row, marginTop: 28 }}>{icons.map(name => <Specimen key={name} label={name}><Icon name={name} size={24} /></Specimen>)}</div>
        <div style={{ ...row, marginTop: 28 }}>{(['soft', 'plain', 'outline'] as const).flatMap(variant => (['sm', 'md', 'lg'] as const).map(size => <Specimen key={variant + size} label={`IconButton ${variant}/${size}`}><IconButton icon="plus" label="Add" variant={variant} size={size} /></Specimen>))}</div>
        <div style={{ ...row, marginTop: 28 }}><Specimen label="PersonAvatar"><PersonAvatar /></Specimen><Specimen label="ProviderLogo airbnb"><ProviderLogo provider="airbnb" /></Specimen><Specimen label="ProviderLogo vrbo"><ProviderLogo provider="vrbo" /></Specimen><Specimen label="bloom-initial"><span className="bloom-initial">A</span></Specimen></div>
      </Section>

      <Section title="Buttons">
        <div style={row}>
          <Specimen label=".bloom-button"><button className="bloom-button">Claim this cleaning</button></Specimen>
          <Specimen label=".bloom-button:disabled"><button className="bloom-button" disabled>Both slots are taken</button></Specimen>
          <Specimen label=".bloom-button.secondary"><button className="bloom-button secondary">Find another city</button></Specimen>
          <Specimen label="OutlineButton"><OutlineButton>Add photos</OutlineButton></Specimen>
          <Specimen label="ButtonContent + icon"><button className="bloom-button secondary"><ButtonContent icon={<Icon name="arrow-right" />}>View cleaning</ButtonContent></button></Specimen>
          <Specimen label="BackButton"><BackButton onClick={() => {}}>Back to cleaning</BackButton></Specimen>
          <Specimen label=".pill-cta"><span className="pill-row" style={{ display: 'inline-flex' }}><span className="pill-cta">View access info <Icon name="right" /></span></span></Specimen>
        </div>
        <div style={{ ...row, marginTop: 28 }}>
          <Specimen label="SelectorPill (cleaner views)"><SelectorPill aria-label="Views">{['calendar', 'upcoming', 'payouts'].map(tab => <button key={tab} className={`vt-btn${view === tab ? ' active' : ''}`} aria-pressed={view === tab} onClick={() => setView(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</SelectorPill></Specimen>
          <Specimen label=".day-pill variants"><div style={{ display: 'grid', gap: 6, width: 200 }}><button className="day-pill open"><span className="dp-plus"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></span><span className="dp-label">Open · 1/2</span></button><button className="day-pill mine"><span className="dp-plus"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span className="dp-label">Mine</span></button><button className="day-pill"><span className="dp-plus">2</span><span className="dp-label">Full</span></button><button className="day-pill selected"><span className="dp-plus">2</span><span className="dp-label">Selected</span></button></div></Specimen>
        </div>
      </Section>

      <Section title="Form controls">
        <div style={row}>
          <Specimen label="Select" width={280}><Select defaultValue="detroit"><option value="detroit">Detroit</option><option value="ann-arbor">Ann Arbor</option></Select></Specimen>
          <Specimen label="Input" width={280}><Input placeholder="Property name" /></Specimen>
          <Specimen label="GuestStars"><GuestStars value={stars} onChange={setStars} /></Specimen>
          <Specimen label="SupplyLevelBar" width={220}><div style={{ display: 'grid', gap: 10 }}>{(['full', 'moderate', 'low', 'empty', 'not_found'] as const).map(level => <div key={level} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 8, fontSize: 12 }}>{level}<SupplyLevelBar level={level} /></div>)}</div></Specimen>
        </div>
      </Section>

      <Section title="Calendar">
        <div style={row}>
          <Specimen label='Calendar mode="single"'><Calendar mode="single" selected={day} onSelect={setDay} /></Specimen>
          <Specimen label='Calendar mode="range" captionLayout="dropdown"'><Calendar mode="range" captionLayout="dropdown" selected={range} onSelect={setRange} /></Specimen>
        </div>
      </Section>

      <Section title="Status">
        <div style={row}>
          <Specimen label="Empty" width={320}><Empty title="No cleanings this month">Check back after your calendars sync.</Empty></Specimen>
          <Specimen label="Loading"><Loading /></Specimen>
          <Specimen label="ErrorNotice" width={360}><ErrorNotice error={new ApiError('SOURCE_UNAVAILABLE', 'Bloom could not complete the request. Please try again.', 'req_123')} retry={() => {}} /></Specimen>
          <Specimen label="Changes" width={360}><Changes changes={[{ id: 'c1', type: 'changed', message: 'Checkout moved from Nov 18 to Nov 19.', acknowledged: false }, { id: 'c2', type: 'conflict', message: 'Airbnb and VRBO disagree on this stay.', acknowledged: false }]} /></Specimen>
        </div>
      </Section>

      <Section title="Check-in">
        <div style={row}>{jobs.map(job => <Specimen key={job.id} label={`CheckInTile · ${job.id}`}><CheckInTile job={job} /></Specimen>)}</div>
        <div style={{ ...row, marginTop: 28 }}>{jobs.slice(0, 3).map(job => <Specimen key={job.id} label={`CheckInNote · ${job.id}`} width={320}><CheckInNote job={job} now={Date.now()} /></Specimen>)}</div>
        <div style={{ ...row, marginTop: 28 }}>{jobs.filter(job => ['urgent', 'soon', 'calm', 'none', 'done'].includes(job.id)).map(job => <Specimen key={job.id} label={`CleaningWindow · ${job.id}`} width={420}><div className="detail-body"><CleaningWindow job={job} /></div></Specimen>)}</div>
      </Section>

      <Section title="Claim cards"><PhoneAndDesktop src="/design/frame?view=day" label="CleanerDayDialog" /></Section>

      <Section title="Claim dialog">
        <div style={{ display: 'grid', gap: 40 }}>
          <PhoneAndDesktop src="/design/frame?view=job&job=urgent" label="JobDetail · open 1/2, check-in soon" />
          <PhoneAndDesktop src="/design/frame?view=job&job=none" label="JobDetail · full (2/2)" />
          <PhoneAndDesktop src="/design/frame?view=job&job=review" label="JobDetail · booking review" />
          <PhoneAndDesktop src="/design/frame?view=job&job=private" label="JobDetail · private team" />
        </div>
      </Section>

      <Section title="Cleaning journey"><PhoneAndDesktop src="/design/frame?view=job&job=mine" label="CleanerJourney · assigned" /></Section>

      <Section title="Cleaner screen"><PhoneAndDesktop src="/design/frame?view=hub" label="CleanerHub · fixtures" height={900} /></Section>

      <Section title="Add listing · entire">
        <div style={{ display: 'grid', gap: 40 }}>{entireSteps.map((name, step) => <PhoneAndDesktop key={name} src={`/design/frame?view=create&type=entire_home&step=${step}`} label={`OwnerCreateListing · entire · ${step + 1}/${entireSteps.length} ${name}`} />)}</div>
      </Section>

      <Section title="Add listing · shared">
        <div style={{ display: 'grid', gap: 40 }}>{sharedSteps.map((name, step) => <PhoneAndDesktop key={name} src={`/design/frame?view=create&type=room&step=${step}`} label={`OwnerCreateListing · shared room · ${step + 1}/${sharedSteps.length} ${name}`} />)}</div>
      </Section>

      <Section title="Add listing · admin">
        <div style={{ display: 'grid', gap: 40 }}>
          <PhoneAndDesktop src="/design/frame?view=admin-create&step=0" label="PropertyForm · 1/2 Import and address" />
          <PhoneAndDesktop src="/design/frame?view=admin-create&step=1&type=entire_home" label="PropertyForm · 2/2 entire home" height={1100} />
          <PhoneAndDesktop src="/design/frame?view=admin-create&step=1&type=room" label="PropertyForm · 2/2 shared room" />
        </div>
      </Section>

      <Section title="Owner screens">
        <div style={{ display: 'grid', gap: 40 }}>{ownerViews.map(([view, name]) => <PhoneAndDesktop key={view} src={`/owner?view=${view}`} label={`/owner · ${name} · your data`} height={900} />)}</div>
      </Section>

      <Section title="Admin screens">
        <div style={{ display: 'grid', gap: 40 }}>{adminViews.map(([view, name]) => <PhoneAndDesktop key={view} src={`/admin?view=${view}`} label={`/admin · ${name} · your data`} height={900} />)}</div>
      </Section>

      <Section title="Live screens">
        <div style={{ display: 'grid', gap: 40 }}>
          <PhoneAndDesktop src="/cleaner" label="/cleaner · your data" height={900} />
        </div>
      </Section>
    </main>
  </div></SessionContext.Provider>;
}
