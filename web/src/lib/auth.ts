import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { type SubscriptionTier, hasEntitlement, setSubscriptionTier } from '@/lib/subscription';

export type UserRole = 'PLATFORM_ADMIN' | 'VENUE_ADMIN' | 'TD' | 'USER';
export type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type PermissionName =
  | 'platform.manage_users'
  | 'platform.manage_venues'
  | 'platform.manage_channels'
  | 'platform.manage_tds'
  | 'platform.manage_subscriptions'
  | 'platform.manage_broadcasts'
  | 'platform.manage_events'
  | 'venue.view'
  | 'venue.edit'
  | 'venue.manage_devices'
  | 'venue.view_events'
  | 'venue.view_broadcasts'
  | 'tournament.create'
  | 'tournament.edit'
  | 'tournament.manage'
  | 'tournament.view_history'
  | 'tournament.manage_broadcast'
  | 'tournament.brand'
  | 'td.manage_profile'
  | 'td.view_channel'
  | 'basic.tournament_limit'
  | 'pro.templates'
  | 'pro.history'
  | 'pro.profile'
  | 'pro.local_broadcast'
  | 'proplus.td_channel'
  | 'proplus.advanced_broadcast'
  | 'proplus.obs'
  | 'proplus.wifi_camera'
  | 'proplus.branding';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tier: SubscriptionTier;
  status: AccountStatus;
  verified: boolean;
  venueIds: string[];
  tdProfileId?: string;
  tdChannelId?: number | null;
  permissions?: PermissionName[];
}

export interface AuthSignUpResult {
  user: AppUser | null;
  requiresEmailConfirmation: boolean;
}

function applyPlatformAdminOverrides(user: AppUser): AppUser {
  if (user.role !== 'PLATFORM_ADMIN') {
    return {
      ...user,
      permissions: normalizePermissions(user.permissions, user.role)
    };
  }

  const mergedPermissions = Array.from(
    new Set<PermissionName>([...ROLE_PERMISSIONS.PLATFORM_ADMIN, ...normalizePermissions(user.permissions, 'PLATFORM_ADMIN')])
  );

  return {
    ...user,
    tier: 'VENUE',
    status: 'ACTIVE',
    verified: true,
    permissions: mergedPermissions
  };
}

export const ROLE_PERMISSIONS: Record<UserRole, PermissionName[]> = {
  PLATFORM_ADMIN: [
    'platform.manage_users',
    'platform.manage_venues',
    'platform.manage_channels',
    'platform.manage_tds',
    'platform.manage_subscriptions',
    'platform.manage_broadcasts',
    'platform.manage_events',
    'venue.view',
    'venue.edit',
    'venue.manage_devices',
    'venue.view_events',
    'venue.view_broadcasts',
    'tournament.create',
    'tournament.edit',
    'tournament.manage',
    'tournament.view_history',
    'tournament.manage_broadcast',
    'tournament.brand',
    'td.manage_profile',
    'td.view_channel'
  ],
  VENUE_ADMIN: [
    'venue.view',
    'venue.edit',
    'venue.manage_devices',
    'venue.view_events',
    'venue.view_broadcasts',
    'tournament.view_history',
    'tournament.manage_broadcast'
  ],
  TD: [
    'tournament.create',
    'tournament.edit',
    'tournament.manage',
    'tournament.view_history',
    'tournament.manage_broadcast',
    'tournament.brand',
    'td.manage_profile',
    'td.view_channel'
  ],
  USER: ['basic.tournament_limit']
};

export const PERMISSION_DESCRIPTIONS: Record<PermissionName, string> = {
  'platform.manage_users': 'Manage platform users and account status',
  'platform.manage_venues': 'Create, approve, and suspend venues',
  'platform.manage_channels': 'Create and administer channel registry assignments',
  'platform.manage_tds': 'Manage TD accounts and channel permissions',
  'platform.manage_subscriptions': 'Manage billing and subscription overrides',
  'platform.manage_broadcasts': 'View and stop live broadcasts',
  'platform.manage_events': 'View and remove tournament events',
  'venue.view': 'View venue profile and activity',
  'venue.edit': 'Edit venue settings and branding',
  'venue.manage_devices': 'Manage venue broadcast devices',
  'venue.view_events': 'View events at the venue',
  'venue.view_broadcasts': 'View venue broadcasts',
  'tournament.create': 'Create tournaments',
  'tournament.edit': 'Edit tournament setup and results',
  'tournament.manage': 'Manage tournament lifecycle and ownership',
  'tournament.view_history': 'Access event and tournament history',
  'tournament.manage_broadcast': 'Control broadcast lifecycle for a tournament',
  'tournament.brand': 'Configure branding and overlays',
  'td.manage_profile': 'Manage TD profile details',
  'td.view_channel': 'View TD channel information',
  'basic.tournament_limit': 'Basic tier cap for limited tournament history',
  'pro.templates': 'Save and reuse tournament templates',
  'pro.history': 'Keep additional tournament history',
  'pro.profile': 'Create and manage profile',
  'pro.local_broadcast': 'Use local broadcasting tools',
  'proplus.td_channel': 'Access a permanent TDTV channel',
  'proplus.advanced_broadcast': 'Use advanced broadcast controls',
  'proplus.obs': 'Use OBS integration',
  'proplus.wifi_camera': 'Configure Wi-Fi camera settings',
  'proplus.branding': 'Configure tournament branding'
};

const USER_STORAGE_KEY = 'tdiab_current_user';
const DEFAULT_USER: AppUser = {
  id: 'guest-user',
  name: 'Guest User',
  email: '',
  role: 'USER',
  tier: 'BASIC',
  status: 'ACTIVE',
  verified: false,
  venueIds: [],
  permissions: ROLE_PERMISSIONS.USER
};

function isValidRole(value: unknown): value is UserRole {
  return value === 'PLATFORM_ADMIN' || value === 'VENUE_ADMIN' || value === 'TD' || value === 'USER';
}

function isValidTier(value: unknown): value is SubscriptionTier {
  return value === 'BASIC' || value === 'PRO' || value === 'PRO_PLUS' || value === 'VENUE';
}

function isValidStatus(value: unknown): value is AccountStatus {
  return value === 'ACTIVE' || value === 'INACTIVE' || value === 'SUSPENDED';
}

function isValidPermission(value: unknown): value is PermissionName {
  return typeof value === 'string' && value in PERMISSION_DESCRIPTIONS;
}

function normalizeVenueIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
}

function normalizePermissions(value: unknown, role: UserRole): PermissionName[] {
  if (!Array.isArray(value)) return ROLE_PERMISSIONS[role];
  return value.filter(isValidPermission);
}

function persistCurrentUser(user: AppUser): AppUser {
  const normalizedUser = applyPlatformAdminOverrides(user);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalizedUser));
  }
  setSubscriptionTier(getEffectiveTier(normalizedUser));
  return normalizedUser;
}

export function clearCurrentUser(): AppUser {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(USER_STORAGE_KEY);
  }
  setSubscriptionTier('BASIC');
  return DEFAULT_USER;
}

function fromStoredUser(user: Partial<AppUser>): AppUser {
  const role = isValidRole(user.role) ? user.role : 'USER';
  return applyPlatformAdminOverrides({
    id: typeof user.id === 'string' && user.id.length > 0 ? user.id : DEFAULT_USER.id,
    name: typeof user.name === 'string' && user.name.length > 0 ? user.name : DEFAULT_USER.name,
    email: typeof user.email === 'string' ? user.email : DEFAULT_USER.email,
    role,
    tier: isValidTier(user.tier) ? user.tier : 'BASIC',
    status: isValidStatus(user.status) ? user.status : 'ACTIVE',
    verified: Boolean(user.verified),
    venueIds: normalizeVenueIds(user.venueIds),
    tdProfileId: typeof user.tdProfileId === 'string' ? user.tdProfileId : undefined,
    tdChannelId: typeof user.tdChannelId === 'number' ? user.tdChannelId : undefined,
    permissions: normalizePermissions(user.permissions, role)
  });
}

const PLATFORM_ADMIN_EMAILS = ['info@promethean-games.com'];

function mapSupabaseUser(user: SupabaseUser): AppUser {
  const appMetadata = user.app_metadata ?? {};
  const userMetadata = user.user_metadata ?? {};
  const email = user.email ?? '';
  const isPlatformAdminUser = PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase());
  const role = isPlatformAdminUser ? 'PLATFORM_ADMIN' : isValidRole(appMetadata.role) ? appMetadata.role : 'USER';

  return {
    id: user.id,
    name:
      typeof userMetadata.name === 'string' && userMetadata.name.length > 0
        ? userMetadata.name
        : typeof userMetadata.full_name === 'string' && userMetadata.full_name.length > 0
          ? userMetadata.full_name
          : email?.split('@')[0] ?? 'User',
    email,
    role,
    tier: isPlatformAdminUser ? 'VENUE' : isValidTier(appMetadata.tier) ? appMetadata.tier : 'BASIC',
    status: isPlatformAdminUser ? 'ACTIVE' : isValidStatus(appMetadata.status) ? appMetadata.status : 'ACTIVE',
    verified: isPlatformAdminUser ? true : Boolean(appMetadata.verified),
    venueIds: normalizeVenueIds(appMetadata.venue_ids),
    tdProfileId: typeof appMetadata.td_profile_id === 'string' ? appMetadata.td_profile_id : undefined,
    tdChannelId: typeof appMetadata.td_channel_id === 'number' ? appMetadata.td_channel_id : undefined,
    permissions: normalizePermissions(appMetadata.permissions, role)
  };
}

export function getCurrentUser(): AppUser {
  if (typeof window === 'undefined') return DEFAULT_USER;

  const raw = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return DEFAULT_USER;

  try {
    return fromStoredUser(JSON.parse(raw) as Partial<AppUser>);
  } catch {
    return DEFAULT_USER;
  }
}

export function setCurrentUser(_userId: string): AppUser {
  return persistCurrentUser(DEFAULT_USER);
}

export function listEffectivePermissions(user: AppUser | null | undefined): PermissionName[] {
  if (!user || user.status !== 'ACTIVE') return [];

  const merged = new Set<PermissionName>([
    ...(user.permissions ?? []),
    ...ROLE_PERMISSIONS[user.role],
    ...(TIER_ENTITLEMENTS[user.tier] ?? [])
  ]);

  return Array.from(merged);
}

export function hasPermission(user: AppUser | null | undefined, permission: PermissionName): boolean {
  if (!user || user.status !== 'ACTIVE') return false;
  if (user.role === 'PLATFORM_ADMIN') return Boolean(user.verified);

  const effective = listEffectivePermissions(user);
  if (effective.includes(permission)) return true;

  return hasEntitlement(user.tier, permission);
}

export function ensurePermission(user: AppUser | null | undefined, permission: PermissionName, context?: string): void {
  if (!hasPermission(user, permission)) {
    const suffix = context ? ` for ${context}` : '';
    throw new Error(`Unauthorized access${suffix}. Required permission: ${permission}`);
  }
}

export function canAccessVenue(user: AppUser | null | undefined, venueId: string): boolean {
  if (!user || user.status !== 'ACTIVE') return false;
  if (user.role === 'PLATFORM_ADMIN') return Boolean(user.verified);
  if (user.role === 'VENUE_ADMIN') return user.venueIds.includes(venueId);
  return false;
}

export function canAccessTournament(user: AppUser | null | undefined, ownerId?: string): boolean {
  if (!user || user.status !== 'ACTIVE') return false;
  if (user.role === 'PLATFORM_ADMIN') return Boolean(user.verified);
  if (user.role === 'TD') {
    return !ownerId || ownerId === user.id || ownerId === user.tdProfileId || user.venueIds.length > 0;
  }
  return false;
}

export function isProPlusTd(user: AppUser | null | undefined): boolean {
  return Boolean(user && user.role === 'TD' && user.tier === 'PRO_PLUS');
}

export const TIER_ENTITLEMENTS: Record<SubscriptionTier, PermissionName[]> = {
  BASIC: ['basic.tournament_limit'],
  PRO: ['pro.templates', 'pro.history', 'pro.profile', 'pro.local_broadcast'],
  PRO_PLUS: ['pro.templates', 'pro.history', 'pro.profile', 'pro.local_broadcast', 'proplus.td_channel', 'proplus.advanced_broadcast', 'proplus.obs', 'proplus.wifi_camera', 'proplus.branding'],
  VENUE: ['venue.view', 'venue.edit', 'venue.manage_devices', 'venue.view_events', 'venue.view_broadcasts', 'pro.templates', 'pro.history', 'pro.profile', 'pro.local_broadcast', 'proplus.td_channel', 'proplus.advanced_broadcast', 'proplus.obs', 'proplus.wifi_camera', 'proplus.branding']
};

export function getEffectiveTier(user: AppUser | null | undefined): SubscriptionTier {
  if (user?.role === 'PLATFORM_ADMIN') return 'VENUE';
  return user?.tier ?? 'BASIC';
}

export function getUserTierLabel(user: AppUser | null | undefined): string {
  if (user?.role === 'PLATFORM_ADMIN') return 'Platform Admin';
  const tier = getEffectiveTier(user);
  return tier.replace('_', '+');
}

export function getUserRoleLabel(user: AppUser | null | undefined): string {
  if (!user) return 'Guest';
  return user.role.replace('_', ' ');
}

export async function initializeAuth(): Promise<AppUser> {
  if (!isSupabaseConfigured || !supabase) {
    return getCurrentUser();
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return clearCurrentUser();
  }

  return persistCurrentUser(mapSupabaseUser(data.user));
}

export function subscribeToAuthChanges(onChange: (user: AppUser) => void): () => void {
  if (!isSupabaseConfigured || !supabase) {
    return () => undefined;
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ? persistCurrentUser(mapSupabaseUser(session.user)) : clearCurrentUser();
    onChange(user);
  });

  return () => {
    data.subscription.unsubscribe();
  };
}

export async function signInWithEmail(email: string, password: string): Promise<AppUser> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase auth is not configured.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.user) {
    throw new Error('No authenticated user was returned.');
  }

  return persistCurrentUser(mapSupabaseUser(data.user));
}

export async function signUpWithEmail(email: string, password: string, name: string): Promise<AuthSignUpResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase auth is not configured.');
  }

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        name: name.trim()
      }
    }
  });

  if (error) {
    throw new Error(error.message);
  }

  const mappedUser = data.user ? mapSupabaseUser(data.user) : null;
  if (mappedUser && data.session) {
    persistCurrentUser(mappedUser);
  }

  return {
    user: mappedUser,
    requiresEmailConfirmation: !data.session
  };
}

export async function signOutCurrentUser(): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  }

  clearCurrentUser();
}

export async function updateCurrentUserProfile(name: string, email: string): Promise<AppUser> {
  const currentUser = getCurrentUser();
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();

  if (!trimmedName) {
    throw new Error('Name is required.');
  }
  if (!trimmedEmail) {
    throw new Error('Email is required.');
  }

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.updateUser({
      email: trimmedEmail !== currentUser.email ? trimmedEmail : undefined,
      data: {
        name: trimmedName,
        full_name: trimmedName
      }
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data.user) {
      const mapped = mapSupabaseUser(data.user);
      const merged = persistCurrentUser({
        ...mapped,
        name: trimmedName,
        email: trimmedEmail !== currentUser.email ? mapped.email : trimmedEmail
      });
      return merged;
    }
  }

  return persistCurrentUser({
    ...currentUser,
    name: trimmedName,
    email: trimmedEmail
  });
}

export async function updateCurrentUserSubscription(tier: SubscriptionTier): Promise<AppUser> {
  const currentUser = getCurrentUser();
  if (currentUser.role === 'PLATFORM_ADMIN') {
    return persistCurrentUser(currentUser);
  }

  if (!isValidTier(tier)) {
    throw new Error('Invalid subscription tier.');
  }

  return persistCurrentUser({
    ...currentUser,
    tier
  });
}
