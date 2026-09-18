import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  type AccessTier,
  type EntitlementId,
  type SubscriptionTier,
  getEntitlementDefinition,
  hasEntitlement,
  isSubscriptionTier,
  resolveAccessTier,
  setSubscriptionTier
} from '@/lib/subscription';

export type UserRole = 'PLATFORM_ADMIN' | 'VENUE_ADMIN' | 'TD' | 'USER';
export type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type PermissionName =
  | 'admin.users.manage'
  | 'admin.tds.manage'
  | 'admin.venues.manage'
  | 'admin.channels.manage'
  | 'admin.tournaments.manage'
  | 'admin.broadcasts.manage'
  | 'admin.players.manage'
  | 'admin.billing.manage'
  | 'admin.entitlements.manage'
  | 'admin.network.manage'
  | 'admin.analytics.view'
  | 'admin.system.manage'
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

export const ROLE_PERMISSIONS: Record<UserRole, PermissionName[]> = {
  PLATFORM_ADMIN: [
    'admin.users.manage',
    'admin.tds.manage',
    'admin.venues.manage',
    'admin.channels.manage',
    'admin.tournaments.manage',
    'admin.broadcasts.manage',
    'admin.players.manage',
    'admin.billing.manage',
    'admin.entitlements.manage',
    'admin.network.manage',
    'admin.analytics.view',
    'admin.system.manage',
    'platform.manage_users',
    'platform.manage_venues',
    'platform.manage_channels',
    'platform.manage_tds',
    'platform.manage_subscriptions',
    'platform.manage_broadcasts',
    'platform.manage_events'
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
  USER: []
};

export const PERMISSION_DESCRIPTIONS: Record<PermissionName, string> = {
  'admin.users.manage': 'Manage platform users and identity records',
  'admin.tds.manage': 'Manage all TD lifecycle actions and assignments',
  'admin.venues.manage': 'Create, approve, suspend, and administer venues',
  'admin.channels.manage': 'Create, assign, suspend, and retire channels',
  'admin.tournaments.manage': 'Manage tournament operations across the network',
  'admin.broadcasts.manage': 'Manage live broadcast health and interventions',
  'admin.players.manage': 'Manage player records, merges, and corrections',
  'admin.billing.manage': 'Manage billing and subscription operations',
  'admin.entitlements.manage': 'Grant and revoke entitlements and access overrides',
  'admin.network.manage': 'Manage network-wide admin operations and controls',
  'admin.analytics.view': 'Access network monitoring and operational analytics',
  'admin.system.manage': 'Manage system settings, audit activity, and platform health',
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
  'basic.tournament_limit': 'Basic tournament history allowance',
  'pro.templates': 'Save and reuse tournament templates',
  'pro.history': 'Access expanded tournament history',
  'pro.profile': 'Access TD profile features',
  'pro.local_broadcast': 'Use local broadcasting tools',
  'proplus.td_channel': 'Publish to TDTV',
  'proplus.advanced_broadcast': 'Use advanced broadcast controls',
  'proplus.obs': 'Use advanced broadcast overlay workflows',
  'proplus.wifi_camera': 'Use TDTV-capable network camera workflows',
  'proplus.branding': 'Configure tournament branding'
};

const PERMISSION_ENTITLEMENTS: Partial<Record<PermissionName, EntitlementId>> = {
  'admin.users.manage': 'internal.full_access',
  'admin.tds.manage': 'internal.full_access',
  'admin.venues.manage': 'internal.full_access',
  'admin.channels.manage': 'internal.full_access',
  'admin.tournaments.manage': 'internal.full_access',
  'admin.broadcasts.manage': 'internal.full_access',
  'admin.players.manage': 'internal.full_access',
  'admin.billing.manage': 'internal.full_access',
  'admin.entitlements.manage': 'internal.full_access',
  'admin.network.manage': 'internal.full_access',
  'admin.analytics.view': 'internal.full_access',
  'admin.system.manage': 'internal.full_access',
  'venue.view': 'venue.administration',
  'venue.edit': 'venue.administration',
  'venue.manage_devices': 'broadcast.venue_network',
  'venue.view_events': 'venue.administration',
  'venue.view_broadcasts': 'broadcast.venue_network',
  'tournament.view_history': 'tournament.history.basic',
  'tournament.manage_broadcast': 'broadcast.local',
  'tournament.brand': 'broadcast.branding',
  'td.manage_profile': 'identity.td_profile',
  'td.view_channel': 'identity.tdtv_presence',
  'basic.tournament_limit': 'tournament.history.basic',
  'pro.templates': 'tournament.templates',
  'pro.history': 'tournament.history.expanded',
  'pro.profile': 'identity.td_profile',
  'pro.local_broadcast': 'broadcast.local',
  'proplus.td_channel': 'broadcast.tdtv',
  'proplus.advanced_broadcast': 'broadcast.overlays_advanced',
  'proplus.obs': 'broadcast.overlays_advanced',
  'proplus.wifi_camera': 'broadcast.tdtv',
  'proplus.branding': 'broadcast.branding'
};

const PURE_ENTITLEMENT_PERMISSIONS = new Set<PermissionName>([
  'basic.tournament_limit',
  'pro.templates',
  'pro.history',
  'pro.profile',
  'pro.local_broadcast',
  'proplus.td_channel',
  'proplus.advanced_broadcast',
  'proplus.obs',
  'proplus.wifi_camera',
  'proplus.branding'
]);

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
  permissions: []
};

export const PLATFORM_ADMIN_EMAIL = (import.meta.env.VITE_PLATFORM_ADMIN_EMAIL ?? 'info@promethean-games.com').trim().toLowerCase();
const PLATFORM_ADMIN_EMAILS = [PLATFORM_ADMIN_EMAIL].filter(Boolean);

export function isAuthorizedPlatformAdminEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;
}

function isValidRole(value: unknown): value is UserRole {
  return value === 'PLATFORM_ADMIN' || value === 'VENUE_ADMIN' || value === 'TD' || value === 'USER';
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
  const basePermissions = ROLE_PERMISSIONS[role];
  if (!Array.isArray(value)) return basePermissions;
  return Array.from(new Set<PermissionName>([...basePermissions, ...value.filter(isValidPermission)]));
}

function applyPlatformAdminOverrides(user: AppUser): AppUser {
  const isAuthorizedAdmin = isAuthorizedPlatformAdminEmail(user.email);
  if (user.role !== 'PLATFORM_ADMIN' || !isAuthorizedAdmin) {
    const normalizedRole = user.role === 'PLATFORM_ADMIN' && !isAuthorizedAdmin ? 'USER' : user.role;
    return {
      ...user,
      role: normalizedRole,
      status: normalizedRole === 'USER' ? user.status : user.status,
      verified: normalizedRole === 'USER' ? user.verified : user.verified,
      permissions: normalizePermissions(user.permissions, normalizedRole)
    };
  }

  return {
    ...user,
    status: 'ACTIVE',
    verified: true,
    permissions: normalizePermissions(user.permissions, 'PLATFORM_ADMIN')
  };
}

function persistCurrentUser(user: AppUser): AppUser {
  const normalizedUser = applyPlatformAdminOverrides(user);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalizedUser));
  }
  setSubscriptionTier(normalizedUser.tier);
  return normalizedUser;
}

function fromStoredUser(user: Partial<AppUser>): AppUser {
  const role = isValidRole(user.role) ? user.role : 'USER';
  return applyPlatformAdminOverrides({
    id: typeof user.id === 'string' && user.id.length > 0 ? user.id : DEFAULT_USER.id,
    name: typeof user.name === 'string' && user.name.length > 0 ? user.name : DEFAULT_USER.name,
    email: typeof user.email === 'string' ? user.email : DEFAULT_USER.email,
    role,
    tier: isSubscriptionTier(user.tier) ? user.tier : 'BASIC',
    status: isValidStatus(user.status) ? user.status : 'ACTIVE',
    verified: Boolean(user.verified),
    venueIds: normalizeVenueIds(user.venueIds),
    tdProfileId: typeof user.tdProfileId === 'string' ? user.tdProfileId : undefined,
    tdChannelId: typeof user.tdChannelId === 'number' ? user.tdChannelId : undefined,
    permissions: normalizePermissions(user.permissions, role)
  });
}

function mapSupabaseUser(user: SupabaseUser): AppUser {
  const appMetadata = user.app_metadata ?? {};
  const userMetadata = user.user_metadata ?? {};
  const email = user.email ?? '';
  const isPlatformAdminUser = isAuthorizedPlatformAdminEmail(email);
  const role = isPlatformAdminUser ? 'PLATFORM_ADMIN' : isValidRole(appMetadata.role) ? appMetadata.role : 'USER';

  return applyPlatformAdminOverrides({
    id: user.id,
    name:
      typeof userMetadata.name === 'string' && userMetadata.name.length > 0
        ? userMetadata.name
        : typeof userMetadata.full_name === 'string' && userMetadata.full_name.length > 0
          ? userMetadata.full_name
          : email?.split('@')[0] ?? 'User',
    email,
    role,
    tier: isSubscriptionTier(appMetadata.tier) ? appMetadata.tier : 'BASIC',
    status: isPlatformAdminUser ? 'ACTIVE' : isValidStatus(appMetadata.status) ? appMetadata.status : 'ACTIVE',
    verified: isPlatformAdminUser ? true : Boolean(appMetadata.verified),
    venueIds: normalizeVenueIds(appMetadata.venue_ids),
    tdProfileId: typeof appMetadata.td_profile_id === 'string' ? appMetadata.td_profile_id : undefined,
    tdChannelId: typeof appMetadata.td_channel_id === 'number' ? appMetadata.td_channel_id : undefined,
    permissions: normalizePermissions(appMetadata.permissions, role)
  });
}

function hasDirectPermission(user: AppUser, permission: PermissionName): boolean {
  return Boolean(user.permissions?.includes(permission) || ROLE_PERMISSIONS[user.role].includes(permission));
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

export function clearCurrentUser(): AppUser {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(USER_STORAGE_KEY);
  }
  setSubscriptionTier('BASIC');
  return DEFAULT_USER;
}

export function getEffectiveTier(user: AppUser | null | undefined): AccessTier {
  return resolveAccessTier(user?.role, user?.tier);
}

export function hasInternalAccess(user: AppUser | null | undefined): boolean {
  return Boolean(user && user.status === 'ACTIVE' && user.verified && getEffectiveTier(user) === 'INTERNAL');
}

export function canAccessEntitlement(user: AppUser | null | undefined, entitlementId: EntitlementId): boolean {
  if (!user || user.status !== 'ACTIVE') return false;
  if (hasInternalAccess(user)) return true;

  const definition = getEntitlementDefinition(entitlementId);
  if (!definition) return false;
  if (definition.roleRestriction && !definition.roleRestriction.includes(user.role)) {
    return false;
  }

  return hasEntitlement(getEffectiveTier(user), entitlementId);
}

export function ensureEntitlement(user: AppUser | null | undefined, entitlementId: EntitlementId, context?: string): void {
  if (!canAccessEntitlement(user, entitlementId)) {
    const suffix = context ? ` for ${context}` : '';
    throw new Error(`Unauthorized access${suffix}. Required entitlement: ${entitlementId}`);
  }
}

export function listEffectivePermissions(user: AppUser | null | undefined): PermissionName[] {
  if (!user || user.status !== 'ACTIVE') return [];
  if (hasInternalAccess(user)) return Object.keys(PERMISSION_DESCRIPTIONS) as PermissionName[];

  return (Object.keys(PERMISSION_DESCRIPTIONS) as PermissionName[]).filter((permission) => hasPermission(user, permission));
}

export function hasPermission(user: AppUser | null | undefined, permission: PermissionName): boolean {
  if (!user || user.status !== 'ACTIVE') return false;
  if (hasInternalAccess(user)) return true;

  const entitlementRequirement = PERMISSION_ENTITLEMENTS[permission];
  if (PURE_ENTITLEMENT_PERMISSIONS.has(permission)) {
    return entitlementRequirement ? canAccessEntitlement(user, entitlementRequirement) : false;
  }

  if (!hasDirectPermission(user, permission)) {
    return false;
  }

  return entitlementRequirement ? canAccessEntitlement(user, entitlementRequirement) : true;
}

export function ensurePermission(user: AppUser | null | undefined, permission: PermissionName, context?: string): void {
  if (!hasPermission(user, permission)) {
    const suffix = context ? ` for ${context}` : '';
    throw new Error(`Unauthorized access${suffix}. Required permission: ${permission}`);
  }
}

export function canAccessVenue(user: AppUser | null | undefined, venueId: string): boolean {
  if (!user || user.status !== 'ACTIVE') return false;
  if (hasInternalAccess(user)) return true;
  if (user.role !== 'VENUE_ADMIN') return false;
  if (!user.venueIds.includes(venueId)) return false;
  return canAccessEntitlement(user, 'venue.administration');
}

export function canAccessTournament(user: AppUser | null | undefined, ownerId?: string): boolean {
  if (!user || user.status !== 'ACTIVE') return false;
  if (hasInternalAccess(user)) return true;
  if (user.role === 'TD') {
    return !ownerId || ownerId === user.id || ownerId === user.tdProfileId || user.venueIds.length > 0;
  }
  if (user.role === 'VENUE_ADMIN') {
    return canAccessEntitlement(user, 'venue.administration');
  }
  return false;
}

export function isProPlusTd(user: AppUser | null | undefined): boolean {
  return Boolean(user && user.role === 'TD' && canAccessEntitlement(user, 'broadcast.tdtv'));
}

export function getUserTierLabel(user: AppUser | null | undefined): string {
  if (user?.role === 'PLATFORM_ADMIN' && isAuthorizedPlatformAdminEmail(user.email)) return 'PLATFORM ADMIN';
  if (user?.role === 'PLATFORM_ADMIN' && !isAuthorizedPlatformAdminEmail(user.email)) return 'BASIC';
  return (user?.tier ?? 'BASIC').replace('_', '+');
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
      return persistCurrentUser({
        ...mapped,
        name: trimmedName,
        email: trimmedEmail !== currentUser.email ? mapped.email : trimmedEmail
      });
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

  if (!isSubscriptionTier(tier)) {
    throw new Error('Invalid subscription tier.');
  }

  return persistCurrentUser({
    ...currentUser,
    tier
  });
}

