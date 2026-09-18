import { Link, useLocation } from 'react-router-dom';
import { getCurrentUser, getUserTierLabel, hasPermission } from '@/lib/auth';
import './Navigation.css';

export default function Navigation() {
  const location = useLocation();
  const currentUser = getCurrentUser();
  const isPlatformAdmin = currentUser.role === 'PLATFORM_ADMIN';

  const isActive = (paths: string[]) => {
    return paths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
      ? 'active'
      : '';
  };

  return (
    <header className="global-nav">
      <div className="global-nav__inner">
        <Link to={isPlatformAdmin ? '/admin' : '/'} className="global-nav__brand">
          <span aria-hidden="true">🎱</span>
          <strong>TD in a Box</strong>
        </Link>

        <nav className="global-nav__links" aria-label="Primary navigation">
          {isPlatformAdmin ? (
            <>
              <Link className={isActive(['/admin'])} to="/admin">Overview</Link>
              <Link className={isActive(['/admin/people'])} to="/admin">People</Link>
              <Link className={isActive(['/admin/tournaments'])} to="/admin">Tournaments</Link>
              <Link className={isActive(['/admin/tdtv'])} to="/admin">TDTV</Link>
              <Link className={isActive(['/admin/billing'])} to="/admin">Billing</Link>
              <Link className={isActive(['/admin/system'])} to="/admin">System</Link>
            </>
          ) : (
            <>
              <Link className={isActive(['/'])} to="/">Home</Link>
              <Link className={isActive(['/tournaments', '/tournament'])} to="/tournaments">Tournaments</Link>
              <Link className={isActive(['/broadcast', '/tv-guide'])} to="/tv-guide">TDTV / TV Guide</Link>
            </>
          )}
          {hasPermission(currentUser, 'platform.manage_users') && !isPlatformAdmin && (
            <Link className={isActive(['/admin'])} to="/admin">Admin Console</Link>
          )}
        </nav>

        <div className="global-nav__meta">
          <span className={`tier-pill ${isPlatformAdmin ? 'tier-pill--platform-admin' : ''}`}>
            {getUserTierLabel(currentUser)}
          </span>
        </div>
      </div>
    </header>
  );
}
