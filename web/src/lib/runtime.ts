import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AppRuntimeMode = 'supabase' | 'local';

export function getRuntimeMode(): AppRuntimeMode {
  return isSupabaseConfigured && supabase ? 'supabase' : 'local';
}

export function getRuntimeStatus() {
  if (isSupabaseConfigured && supabase) {
    return {
      mode: 'supabase' as const,
      isReady: true,
      message: 'Supabase connected. Server-backed data and auth are enabled.'
    };
  }

  return {
    mode: 'local' as const,
    isReady: false,
    message: 'Local fallback is active. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable the production backend.'
  };
}
