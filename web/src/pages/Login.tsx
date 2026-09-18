import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isSupabaseConfigured } from '@/lib/supabase';
import { signInWithEmail, signUpWithEmail } from '@/lib/auth';
import './Login.css';

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'sign-in' | 'create-account'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);

    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email, password);
        navigate('/account');
      } else {
        const result = await signUpWithEmail(email, password, name);
        setMessage(
          result.requiresEmailConfirmation
            ? 'Account created. Check your email to confirm your sign-in before continuing.'
            : 'Account created. You are now signed in.'
        );
        if (!result.requiresEmailConfirmation) {
          navigate('/account');
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to complete authentication.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-copy">
          <span className="login-eyebrow">Secure access</span>
          <h1>{mode === 'sign-in' ? 'Sign in to TD in a Box' : 'Create your account'}</h1>
          <p>
            Use your Supabase-backed email and password to access your account. Platform Admin access still
            requires verified server-side metadata and is not granted by self-signup alone.
          </p>
        </div>

        {!isSupabaseConfigured && (
          <div className="login-notice login-notice--warning">
            Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to continue.
          </div>
        )}

        {error && <div className="login-notice login-notice--error">{error}</div>}
        {message && <div className="login-notice login-notice--success">{message}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          {mode === 'create-account' && (
            <div className="login-field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                required
              />
            </div>
          )}

          <div className="login-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              minLength={6}
              required
            />
          </div>

          <button type="submit" className="login-submit" disabled={!isSupabaseConfigured || submitting}>
            {submitting ? 'Please wait...' : mode === 'sign-in' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="login-footer">
          <button
            type="button"
            className="login-switch"
            onClick={() => {
              setMode(mode === 'sign-in' ? 'create-account' : 'sign-in');
              setError(null);
              setMessage(null);
            }}
          >
            {mode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
          </button>
          <Link to="/" className="login-link">
            Return home
          </Link>
        </div>
      </div>
    </div>
  );
}
