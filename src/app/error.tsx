'use client';
import { SetupUnavailable } from '../components/setup-unavailable';

/** Unexpected exceptions have no established public diagnosis; never infer configuration here. */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <SetupUnavailable retry={reset} />;
}
