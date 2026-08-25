import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LOGO_URL, BRAND_NAME, APP_SUBTITLE, NAV_UPLOAD, NAV_PACKAGES, NAV_DEPLOYMENTS } from '../config';

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        {LOGO_URL && (
          <img
            src={LOGO_URL}
            alt={BRAND_NAME}
            style={{ height: 36, objectFit: 'contain', background: '#1a202c', borderRadius: 6, padding: '4px 8px' }}
          />
        )}
        <span className="logo-text">{BRAND_NAME}</span>
        <span className="logo-sub">{APP_SUBTITLE}</span>
      </div>
      <div className="navbar-links">
        <NavLink to="/upload" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>{NAV_UPLOAD}</NavLink>
        <NavLink to="/packages"    className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>{NAV_PACKAGES}</NavLink>
        {isAdmin && <NavLink to="/deployments" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>{NAV_DEPLOYMENTS}</NavLink>}
      </div>
      <div className="navbar-user">
        <span className="user-email">{user}</span>
        {!isAdmin && <span className="badge badge-grey" style={{marginRight: 8}}>Read only</span>}
        <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
      </div>
    </nav>
  );
}
