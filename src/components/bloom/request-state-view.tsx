'use client';

import { requestStateCopy, type RequestStateKind } from './request-state';

export function RequestState({ kind, message, requestId, retry }: {
  kind: RequestStateKind; message?: string; requestId?: string; retry?: () => void;
}) {
  const copy = requestStateCopy[kind];
  return <section className="bloom-notice bloom-request-state" role={kind === 'onboarding' ? 'status' : 'alert'}>
    <h2>{copy.title}</h2>
    <p>{message || copy.description}</p>
    {requestId && <small>Reference: {requestId}</small>}
    <div className="bloom-actions">
      {kind === 'signin' ? <a className="bloom-button" href="/sign-in">Sign in</a> :
        kind === 'onboarding' ? <a className="bloom-button" href="/onboarding">Continue onboarding</a> :
        kind === 'denied' ? <a className="bloom-button" href="/">Return to your hub</a> :
        retry ? <button type="button" className="bloom-button" onClick={retry}>Try again</button> :
        <button type="button" className="bloom-button" onClick={() => window.location.reload()}>Try again</button>}
    </div>
  </section>;
}
