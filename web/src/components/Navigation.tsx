import { Link, useLocation } from 'react-router-dom';
import { getCurrentUser, hasPermission } from '@/lib/auth';
import { getSubscriptionTier } from '@/lib/subscription';
import './Navigation.css';

export default function Navigation() {
  const location = useLocation();
  const tier = getSubscriptionTier();
  const currentUser = getCurrentUser();

  const isActive = (paths: string[]) => {
    return paths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
      ? 'active'
      : '';
  };

  return (
    <header className="global-nav">
      <div className="global-nav__inner">
        <Link to="/" className="global-nav__brand">
          <span aria-hidden="true">🎱</span>
          <strong>TD in a Box</strong>
        </Link>

        <nav className="global-nav__links" aria-label="Primary navigation">
          <Link className={isActive(['/'])} to="/">Home</Link>
          <Link className={isActive(['/tournaments', '/tournament'])} to="/tournaments">Tournaments</Link>
          <Link className={isActive(['/broadcast', '/tv-guide'])} to="/tv-guide">TDTV / TV Guide</Link>
          {hasPermission(currentUser, 'platform.manage_users') && (
            <Link className={isActive(['/admin'])} to="/admin">Admin Console</Link>
          )}
        </nav>

        <div className="global-nav__meta">
          <span className="tier-pill">{tier.replace('_', '+')}</span>
        </div>
      </div>
    </header>
  );
}
