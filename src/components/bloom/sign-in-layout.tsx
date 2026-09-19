'use client';
import { useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import styles from './sign-in.module.css';

const panels = [
  { name: 'Cleaners', eyebrow: 'Your next cleaning', heading: <>Your day.<br />Beautifully organized.</>, description: 'Find available cleanings, keep track of your jobs, and share the finishing touches.', board: 'Cleaner Hub', steps: [['Find a cleaning', 'Browse jobs in your approved city'], ['Claim your place', 'Two available assignment slots per job'], ['Share the finish', 'Upload room photos and complete the job']] },
  { name: 'Owners', eyebrow: 'Your properties, together', heading: <>Every stay.<br />One clear view.</>, description: 'See your properties’ booking calendars together, with changes right where they belong.', board: 'Owner Hub', steps: [['One calendar', 'Airbnb and Vrbo bookings together'], ['Your properties', 'Filter the calendar by property'], ['Stay informed', 'See booking changes and sync freshness']] },
  { name: 'Admins', eyebrow: 'Keep everything running', heading: <>Every detail.<br />Taken care of.</>, description: 'Manage properties, coordinate cleanings, and keep your team ready for the next stay.', board: 'Admin Hub', steps: [['Set up properties', 'Ownership, instructions, and calendar sources'], ['Coordinate the team', 'Manage jobs and cleaner assignments'], ['See the results', 'Review the shared completion photos']] },
];

function BloomMark({ className }: { className?: string }) {
  return <svg className={className} width="44" height="44" viewBox="0 0 40 40" aria-hidden="true"><g transform="translate(20 20)">
    <ellipse cx="0" cy="-10" rx="6" ry="9" fill="#f0c4cb" />
    <ellipse cx="9.5" cy="-3.1" rx="6" ry="9" fill="#e89ba9" transform="rotate(72)" />
    <ellipse cx="5.9" cy="8.1" rx="6" ry="9" fill="#d97a85" transform="rotate(144)" />
    <ellipse cx="-5.9" cy="8.1" rx="6" ry="9" fill="#e89ba9" transform="rotate(216)" />
    <ellipse cx="-9.5" cy="-3.1" rx="6" ry="9" fill="#f0c4cb" transform="rotate(288)" />
    <circle cx="0" cy="0" r="3.5" fill="#2d2a1f" />
  </g></svg>;
}

export function BloomSignInLayout({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  function navigateTab(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === 'ArrowRight' ? (active + 1) % panels.length : event.key === 'ArrowLeft' ? (active + panels.length - 1) % panels.length : event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setActive(next); tabs.current[next]?.focus();
  }
  return <main className={styles.root}>
    <div className={styles.page}><div className={styles.shell}>
      <section className={styles.story} aria-label="Explore Bloom">
        <div className={styles['story-head']}><div className={styles['brand-lockup']}><BloomMark className={styles.logo} /><span>Bloom</span></div></div>
        <div className={styles['product-stage']}>
          {panels.map((panel, index) => <div key={panel.name} className={`${styles['story-copy']} ${styles['product-slide']}`} id={`bloom-tour-${index}`} hidden={active !== index} role="tabpanel" tabIndex={0} aria-labelledby={`bloom-tab-${index}`}>
            <p className={styles.eyebrow}>{panel.eyebrow}</p><h2>{panel.heading}</h2><p>{panel.description}</p>
            <div className={styles.board} aria-label={`${panel.board} feature overview`}>
              <div className={styles['board-head']}><span>{panel.board}</span><span className={styles.status}><i aria-hidden="true" />Built around your day</span></div>
              <div className={styles.jobs}>{panel.steps.map(([title, detail], step) => <div className={styles.job} key={title}><span className={styles.time}>0{step + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></div>)}</div>
              <div className={styles['board-foot']}>A place for every detail.</div>
            </div>
          </div>)}
        </div>
        <div className={styles['carousel-nav']}>
          <div className={styles['product-tabs']} role="tablist" aria-label="Explore Bloom features">{panels.map((panel, index) => <button type="button" role="tab" key={panel.name} id={`bloom-tab-${index}`} ref={node => { tabs.current[index] = node; }} onClick={() => setActive(index)} onKeyDown={navigateTab} aria-controls={`bloom-tour-${index}`} aria-selected={active === index} tabIndex={active === index ? 0 : -1}>{panel.name}</button>)}</div>
          <div className={styles['carousel-arrows']}><button type="button" aria-label="Previous feature" onClick={() => setActive((active + panels.length - 1) % panels.length)}>←</button><button type="button" aria-label="Next feature" onClick={() => setActive((active + 1) % panels.length)}>→</button></div>
        </div>
      </section>
      <section className={styles.login} aria-label="Sign in to Bloom"><div className={styles['login-content']}>
        <BloomMark className={styles['mobile-logo']} /><p className={styles.eyebrow}>Your Bloom workspace</p>
        {children}
        <p className={styles.help}>One sign-in for your Bloom workspace.<br />Your account determines which hub you can access.</p>
      </div></section>
    </div></div>
  </main>;
}

/** Same branded shell as login; only the panel changes while recovering a session. */
export function BloomSessionRecovery({ requestId, retry }: { requestId?: string; retry?: () => void }) {
  return <BloomSignInLayout><div className={styles.recovery} role="alert">
    <h1>Let’s get you back in.</h1>
    <p>We couldn’t verify your session. Sign in again to return to your Bloom workspace.</p>
    <a className={styles['recovery-primary']} href="/sign-in">Sign in to Bloom</a>
    {retry && <button type="button" className={styles['recovery-retry']} onClick={retry}>Already signed in? Try again</button>}
    {requestId && <details><summary>Support details</summary><small>Reference: {requestId}</small></details>}
  </div></BloomSignInLayout>;
}
