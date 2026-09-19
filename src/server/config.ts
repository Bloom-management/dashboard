import 'server-only';
export function identityConfigured() {
  return ['CLERK_SECRET_KEY','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].every(name => {
    const value = process.env[name]; return !!value && !value.startsWith('replace_');
  });
}
