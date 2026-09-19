import { redirect } from 'next/navigation';
import { pageSession } from '../server/auth/page-access';
import { SetupUnavailable } from '../components/setup-unavailable';
export const dynamic = 'force-dynamic';
export default async function Home() { const user = await pageSession(); if (!user) return <SetupUnavailable />; redirect(`/${user.role}`); }
