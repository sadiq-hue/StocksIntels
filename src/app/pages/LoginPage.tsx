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
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <GoogleLogin onSuccess={handleSuccess} onError={handleError} />
    </div>
  );
};

export default LoginPage;
