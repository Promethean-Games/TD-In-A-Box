# TD in a Box Web - Quick Start Guide

## What You Have

✅ **Backend** (Express + TypeScript)
- API server running on `http://localhost:3000`
- Tournament engine with command processing
- Domain models for players, tournaments, matches

✅ **Frontend** (React + TypeScript + Vite)
- Web UI running on `http://localhost:5173`
- Navigation component
- Page stubs (Dashboard, Tournament Setup, Workspace, Broadcast)
- Zustand state management

✅ **Database Schema** (PostgreSQL)
- Complete SQL schema ready to load
- Tables for users, players, tournaments, matches, subscriptions

---

## Prerequisites

Before you can run the web app, you need:

1. **Node.js 18+** - [Download](https://nodejs.org/)
2. **PostgreSQL 12+** - [Download](https://www.postgresql.org/download/)
3. **npm** (comes with Node.js)

### Verify installations:
```bash
node --version      # Should be v18 or higher
npm --version       # Should be 9 or higher
psql --version      # Should be 12 or higher
```

---

## Step 1: Set Up Database

### Create the database

```bash
# Connect to PostgreSQL
psql -U postgres

# In the psql prompt, create the database:
CREATE DATABASE tdiab_dev;
\q
```

### Load the schema

```bash
# From the web directory
cd web

# Load the schema into your database
psql -U postgres -d tdiab_dev -f backend/src/db/schema.sql
```

Verify it worked:
```bash
psql -U postgres -d tdiab_dev -c "\dt"
```

You should see tables like `users`, `players`, `tournaments`, `matches`, etc.

---

## Step 2: Install Dependencies

```bash
cd web

# Install all dependencies (root, backend, frontend)
npm install
```

This will:
- Install root dependencies
- Install backend dependencies (Express, TypeScript, pg-promise, etc.)
- Install frontend dependencies (React, Vite, Zustand, etc.)

---

## Step 3: Start the Application

### Option A: Start both backend and frontend together

```bash
cd web
npm run dev
```

This opens two processes:
- **Backend API**: http://localhost:3000
- **Frontend UI**: http://localhost:5173

### Option B: Start separately (if you need to debug)

**Terminal 1 - Backend:**
```bash
cd web/backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd web/frontend
npm run dev
```

---

## Step 4: Open in Browser

Navigate to: **http://localhost:5173**

You should see:
- Navigation bar with "🎱 TD in a Box" logo
- Dashboard page with "Create New Tournament" button
- "Your Tournaments" section (empty for now)

---

## What Works Right Now

✅ **Page Navigation**
- Click "Dashboard" to see tournament list
- Click "New Tournament" to go to setup form
- Mobile responsive menu

✅ **State Management**
- Tournament store is set up with Zustand
- API client is configured with axios
- LocalStorage persistence enabled

✅ **Business Logic**
- Tournament engine is 100% ported
- All domain models are available
- Feature gating and entitlements ready

---

## What's Still Being Built

🚧 **API Endpoints** - Routes to create tournaments, add players, etc.
🚧 **Database Integration** - Connecting endpoints to PostgreSQL
🚧 **Tournament Workspace** - Full UI for managing tournaments
🚧 **Authentication** - Login/signup and JWT tokens
🚧 **Broadcast View** - TDTV read-only display

---

## Testing the Backend Directly

If you want to test the backend API without the frontend:

```bash
cd web/backend

# Start the server
npm run dev

# In another terminal, test the health endpoint
curl http://localhost:3000/api/health
```

You should get:
```json
{
  "status": "ok",
  "timestamp": "2026-09-17T10:43:00.000Z",
  "version": "1.0.0"
}
```

---

## Stopping the Application

Press `Ctrl+C` in the terminal(s) running the dev servers.

---

## Troubleshooting

### "Cannot find module" errors
```bash
# Make sure you're in the web directory
cd web

# Clean install
rm -rf node_modules backend/node_modules frontend/node_modules
npm install
```

### Database connection errors
```bash
# Verify PostgreSQL is running
psql -U postgres -c "SELECT version();"

# Check .env file has correct DATABASE_URL
cat backend/.env | grep DATABASE_URL
```

### Port already in use (3000 or 5173)
```bash
# Find what's using port 3000
lsof -i :3000

# Find what's using port 5173
lsof -i :5173

# Kill the process (on Windows, use Task Manager)
kill -9 <PID>
```

### "tdiab_dev" database doesn't exist
```bash
# Recreate it
psql -U postgres

# In psql:
CREATE DATABASE tdiab_dev;
\q

# Then load the schema:
psql -U postgres -d tdiab_dev -f backend/src/db/schema.sql
```

---

## File Locations

```
TD-In-A-Box/
├── web/                           # ← You are here
│   ├── backend/
│   │   ├── src/
│   │   │   ├── index.ts          # ← Backend entry point
│   │   │   ├── domain/
│   │   │   │   ├── models.ts     # ← All types/enums
│   │   │   │   └── services.ts   # ← Business logic
│   │   │   ├── engine/
│   │   │   │   ├── TournamentEngine.ts
│   │   │   │   └── FormatEngines.ts
│   │   │   └── db/
│   │   │       └── schema.sql    # ← Database tables
│   │   ├── .env                  # ← Configuration (created)
│   │   └── package.json
│   │
│   ├── frontend/
│   │   ├── index.html            # ← HTML entry point
│   │   ├── src/
│   │   │   ├── main.tsx          # ← React entry
│   │   │   ├── App.tsx           # ← Root component
│   │   │   ├── store/
│   │   │   │   └── tournamentStore.ts  # ← State management
│   │   │   ├── pages/            # ← Page components
│   │   │   ├── components/       # ← Reusable UI components
│   │   │   └── index.css         # ← Global styles
│   │   ├── .env                  # ← Configuration (created)
│   │   └── package.json
│   │
│   ├── package.json              # ← Monorepo root
│   └── README.md                 # ← Full documentation
```

---

## Next Steps After Running

Once you see the app running:

1. **Create a tournament** - The form is there but doesn't wire to API yet
2. **Check the console** - Backend server logs and frontend dev console
3. **Look at the code** - Everything is TypeScript with good type safety
4. **Try adding a player** - The UI is waiting for API integration

---

## Questions?

- Check `web/README.md` for full documentation
- Check `web/backend/src/domain/models.ts` for all types
- Check `web/frontend/src/store/tournamentStore.ts` for state management

Everything is ready - we just need to wire the frontend to the backend APIs next!
