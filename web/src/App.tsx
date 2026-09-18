import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTournamentStore } from '@/store/tournamentStore';
import { initializeAuth, subscribeToAuthChanges } from '@/lib/auth';
import { getRuntimeStatus } from '@/lib/runtime';
import Navigation from '@/components/Navigation';

// Pages
import Dashboard from '@/pages/Dashboard';
import Tournament from '@/pages/Tournament';
import TournamentSetup from '@/pages/TournamentSetup';
import Tournaments from '@/pages/Tournaments';
import Workspace from '@/pages/Workspace';
import BroadcastView from '@/pages/BroadcastView';
import CameraSender from '@/pages/CameraSender';
import TvGuide from '@/pages/TvGuide';
import TdtvViewer from '@/pages/TdtvViewer';
import Login from '@/pages/Login';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import TermsOfService from '@/pages/TermsOfService';
import AdminConsole from '@/pages/AdminConsole';
import AccountPage from '@/pages/AccountPage';

import './App.css';

function App() {
  const { hydrate } = useTournamentStore();
  const [, setAuthVersion] = useState(0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    void initializeAuth().finally(() => {
      setAuthVersion((value) => value + 1);
    });

    return subscribeToAuthChanges(() => {
      setAuthVersion((value) => value + 1);
    });
  }, []);

  return (
    <Router>
      <AppLayout />
    </Router>
  );
}

function AppLayout() {
  const location = useLocation();
  const isViewerOnly = location.pathname.startsWith('/tdtv');
  const runtimeStatus = getRuntimeStatus();

  return (
      <div className="app-shell">
        {!runtimeStatus.isReady && (
          <div className="runtime-banner" role="status" aria-live="polite">
            {runtimeStatus.message}
          </div>
        )}
        {!isViewerOnly && <Navigation />}
        <main className={`main-content ${isViewerOnly ? 'main-content--viewer' : ''}`}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/terms-of-service" element={<TermsOfService />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/admin" element={<AdminConsole />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/tournament/new" element={<TournamentSetup />} />
            <Route path="/tournament/:id" element={<Tournament />} />
            <Route path="/tournament/:id/workspace" element={<Workspace />} />
            <Route path="/broadcast/:id" element={<BroadcastView />} />
            <Route path="/camera-link/:pairCode" element={<CameraSender />} />
            <Route path="/tv-guide" element={<TvGuide />} />
            <Route path="/tdtv" element={<TdtvViewer />} />
            <Route path="/tdtv/channel/:channelId" element={<TdtvViewer />} />
          </Routes>
        </main>
      </div>
  );
}

export default App;
