import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';

export type Role = 'customer' | 'chef' | 'admin';

const VALID_ROLES: Role[] = ['customer', 'chef', 'admin'];

export async function getRole(): Promise<Role> {
  const user = await currentUser();
  const role = user?.publicMetadata?.role as Role | undefined;
  return role && VALID_ROLES.includes(role) ? role : 'customer';
}

/** Page server components: redirects to /?error=access_denied if role not allowed */
export async function requireRole(...allowed: Role[]): Promise<void> {
  const { userId } = await auth();
  if (!userId) redirect('/');
  const role = await getRole();
  if (!allowed.includes(role)) redirect('/?error=access_denied');
}

/** API routes: returns 401/403 NextResponse if not authorized, or { userId } if OK */
export async function requireApiRole(
  ...allowed: Role[]
): Promise<NextResponse | { userId: string }> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = await getRole();
  if (!allowed.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return { userId };
}

/** API routes that need any authenticated user */
export async function requireAuth(): Promise<NextResponse | { userId: string }> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return { userId };
}
