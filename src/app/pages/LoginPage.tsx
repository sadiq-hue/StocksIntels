import React, { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import jwt_decode from 'jwt-decode';

type DecodedToken = {
  sub: string;
  name: string;
  email: string;
  picture: string;
};

const LoginPage: React.FC = () => {
  const { setUser } = useAuth();

const handleSuccess = (credentialResponse: any) => {
    if (credentialResponse?.credential) {
      const decoded = jwt_decode<DecodedToken>(credentialResponse.credential);
      setUser({
        name: decoded.name,
        email: decoded.email,
        picture: decoded.picture,
      });
      // TODO: integrate with your auth backend if needed
    }
  };

  const handleError = () => {
    console.error('Google login failed');
  };

  // Clean up on unmount if needed
  useEffect(() => {
    return () => {
      googleLogout();
    };
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box', overflow: 'auto', position: 'relative', overflowX: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: '6%', top: '8%', background: 'rgba(255,255,255,0.9)', padding: '6px 10px', borderRadius: 999, fontSize: 12, boxShadow: '0 6px 18px rgba(11,105,163,0.06)' }}>NGX ₦</div>
        <div style={{ position: 'absolute', right: '8%', top: '18%', background: 'rgba(255,255,255,0.9)', padding: '6px 10px', borderRadius: 999, fontSize: 12, boxShadow: '0 6px 18px rgba(11,105,163,0.06)' }}>JSE R</div>
        <div style={{ position: 'absolute', left: '50%', top: '6%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.9)', padding: '6px 10px', borderRadius: 999, fontSize: 12, boxShadow: '0 6px 18px rgba(11,105,163,0.06)' }}>NYSE $</div>
        <div style={{ position: 'absolute', right: '6%', top: '6%', background: 'rgba(255,255,255,0.9)', padding: '6px 10px', borderRadius: 999, fontSize: 12, boxShadow: '0 6px 18px rgba(11,105,163,0.06)' }}>NASDAQ $</div>
      </div>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 10 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(90deg,#0B69A3,#2D8FD6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src="/logo.svg" alt="logo" style={{ width: 20, height: 20 }} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, color: '#0f1724', fontWeight: 700 }}>StocksIntels</div>
              <div style={{ fontSize: 20, color: '#0B69A3', fontWeight: 800 }}>StocksIntels</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Welcome back</div>
        </div>
        <div style={{ padding: 10, borderRadius: 12, background: 'rgba(255,255,255,0.95)', boxShadow: '0 8px 30px rgba(11,105,163,0.06)', display: 'flex', justifyContent: 'center' }}>
          <GoogleLogin onSuccess={handleSuccess} onError={handleError} />
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
