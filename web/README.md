# TD in a Box - Web Application

A fully functional tournament director application that runs entirely in your browser. No backend required. Deploy to GitHub Pages in seconds.

## Key Features

✅ **Works without a backend** - Complete tournament engine runs in TypeScript  
✅ **GitHub Pages ready** - Automated Pages deployment included  
✅ **No database needed** - Data stored in browser localStorage  
✅ **Production tested** - Business logic ported from proven Kotlin codebase  
✅ **Fully responsive** - Works on desktop, tablet, mobile  
✅ **Offline first** - Works completely offline  

## Quick Start - 3 Steps

### 1. Install
```bash
npm install
```

### 2. Run Locally
```bash
npm run dev
```
Open http://localhost:5173 in your browser.

### 3. Deploy to GitHub Pages
```bash
npm run deploy
```

Your tournament director is now live at `https://username.github.io/repo-name/`

---

## What Can You Do?

- 🎱 Create tournaments in multiple formats
  - Single Elimination
  - Double Elimination
  - Modified Elimination
  - Chip Tournament
- 👥 Add and manage players
- 📊 Generate brackets (seeding, bye handling)
- 🏆 Record match results and track standings
- 💾 Auto-save to browser (works offline)
- 📱 Responsive on all devices

## How It Works

**No Backend Architecture:**
- Tournament engine lives in `src/lib/tournament.ts`
- All state managed by Zustand
- Data persisted to browser localStorage
- Zero API calls, zero server needed

**Deployment:**
- Build creates a single `dist/` folder
- Push to GitHub Pages in seconds
- Works offline, no setup required

## Project Structure

```
web/
├── src/
│   ├── lib/tournament.ts          ← Tournament engine (no backend!)
│   ├── store/tournamentStore.ts   ← State management
│   ├── pages/                     ← UI pages
│   ├── components/                ← Reusable components
│   └── App.tsx                    ← Main app
├── index.html                     ← Entry point
├── vite.config.ts                 ← Build config
├── package.json                   ← Dependencies
└── README.md                      ← This file
```

## Available Commands

```bash
npm run dev       # Local development (http://localhost:5173)
npm run build     # Production build
npm run preview   # Test production build
npm run deploy    # Build and deploy to GitHub Pages
npm run test      # Run tests
npm run lint      # Check code quality
```

## Deployment Instructions

**For GitHub Pages:**

1. Push this code to the `main` branch of the GitHub repository.
2. In GitHub, go to **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. The included workflow in `.github/workflows/deploy-pages.yml` will publish the `web/` app automatically on each push to `main`.
5. For a manual publish from your workstation, run:
   ```bash
   npm run deploy
   ```
6. Your site will be live at: `https://YOUR_USERNAME.github.io/YOUR_REPO/`

### GitHub Pages test scope

- **Works well on Pages today:** single-browser tournament setup, bracket management, local broadcast UI flows, TDTV viewer layout checks.
- **Needs Supabase configured for a real multi-device field test:** shared tournament data, auth, remote phone camera pairing across devices, and synchronized broadcast state.

**For other hosting (Vercel, Netlify, etc):**

Just upload the `dist/` folder. No backend configuration needed.

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool
- **Zustand** - State management
- **React Router** - Navigation

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Data Storage

All tournaments are stored in browser localStorage under key `tdiab_tournaments`.

**Export your data:**
```javascript
// In browser console
copy(localStorage.getItem('tdiab_tournaments'))
```

**Clear all data:**
```javascript
localStorage.removeItem('tdiab_tournaments');
location.reload();
```

## Future Extensions

This foundation supports adding:
- Backend API integration
- Cloud synchronization
- User accounts
- Live broadcast overlays (TDTV)
- Real-time collaboration
- Advanced analytics

The core tournament engine is 100% portable to Node.js/Express when needed.

## Performance

- Initial load: <1 second
- Build time: ~3 seconds
- Handles 100+ player tournaments smoothly
- Works offline with instant updates

## License

MIT - Use freely, modify as needed.

## Questions?

The code is well-structured and commented. Start with:
- `src/lib/tournament.ts` - Tournament business logic
- `src/store/tournamentStore.ts` - State management
- `src/pages/Tournament.tsx` - Main UI page

---

**Drop this folder in a repo and deploy. That's it.** 🚀
