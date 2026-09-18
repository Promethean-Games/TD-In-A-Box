# TD in a Box

TD in a Box is a Kotlin Multiplatform tournament director application. The shared KMP layer is the source of truth for tournament business rules, while Android and the future iOS client remain platform-specific presentation layers.

## Architecture

- Shared KMP core: `shared/`
- Android client: `androidApp/`
- iOS-ready app shell: `iosApp/`

### Shared modules

The shared code is organized around domain and engine responsibilities rather than platform-specific UI concerns:

- `shared/src/commonMain/kotlin/com/promethean/tdiab/domain`
- `shared/src/commonMain/kotlin/com/promethean/tdiab/tournament`
- `shared/src/commonMain/kotlin/com/promethean/tdiab/formats`
- `shared/src/commonMain/kotlin/com/promethean/tdiab/account`
- `shared/src/commonMain/kotlin/com/promethean/tdiab/entitlements`
- `shared/src/commonMain/kotlin/com/promethean/tdiab/broadcast`
- `shared/src/commonMain/kotlin/com/promethean/tdiab/importexport`
- `shared/src/commonMain/kotlin/com/promethean/tdiab/repositories`
- `shared/src/commonMain/kotlin/com/promethean/tdiab/validation`

## Server and deployment setup

The browser app is designed to operate in two modes:

- Local mode: works without a backend for UI testing and workflow exploration.
- Supabase mode: enables authenticated access, platform admin gating, and persistent data.

### Environment variables

Copy the web app example environment file and add your project values:

```bash
cd web
cp .env.example .env
```

Required variables:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Supabase schema

The repository includes the server-side schema at `supabase/schema.sql`.

Apply it in Supabase SQL Editor to provision:

- profiles
- venues
- channels
- tournaments
- tournament_players
- broadcast_configs
- sponsors
- auth trigger for profile creation
- RLS policies for owner/admin access

### Production deployment

This app is ready for static hosting or a Supabase-backed deployment, but the live backend must be configured in the target environment before production usage.

## Build status

Validated successfully in this environment:

- Android shared tests: `./gradlew :shared:jvmTest --no-daemon`
- Android app assembly: `./gradlew :androidApp:assembleDebug --no-daemon`
- Web tests and production build: `cd web && npm test -- --run && npm run build`

## iOS status

The repository includes an `iosApp/` skeleton for future SwiftUI integration. Full Xcode project generation and build verification require a macOS/Xcode environment and were not executed here because this session is running on Windows.

## Foundation rule

This repository is intentionally paused at Phase 0: project foundation, shared module structure, Android target, and iOS-ready scaffold. No Phase 1 domain engine work is being added beyond the foundation set necessary for the project to build cleanly.
