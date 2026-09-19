import { BloomSessionRecovery } from './bloom/sign-in-layout';
import { RequestState } from './bloom/request-state-view';
import { requestStateKind, type RequestStateKind } from './bloom/request-state';
import '../styles/bloom-cleaner.css';
import '../styles/bloom-application.css';

/** Legacy no-argument callers supply no established cause: show service recovery, not a diagnosis. */
export function SetupUnavailable({ code, kind, requestId, retry }: { code?: string; kind?: RequestStateKind; requestId?: string; retry?: () => void } = {}) {
  if ((kind ?? requestStateKind(code)) === 'signin') return <BloomSessionRecovery requestId={requestId} retry={retry} />;
  return <div className="bloom-cleaner app"><header className="topbar"><span className="brand-name">Bloom</span></header>
    <main className="main-inner bloom-recovery"><h1 className="bloom-sr-only">Bloom account access</h1>
      <RequestState kind={kind ?? requestStateKind(code)} requestId={requestId} retry={retry} />
    </main></div>;
}
