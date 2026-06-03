import React from 'react';
import { AuthProvider, useAuth } from '../auth/AuthContext';

const ChatContent: React.FC = () => {
  return <div>Chat interface goes here.</div>;
};

const ChatPage: React.FC = () => {
  const { user, setUser } = useAuth();

  // This effect would be replaced by real login handling
  // For now, if no user, show LoginPage component
  if (!user) {
    return <LoginPage />;
  }

  return (
    <div>
      <header>
        <img src={user.picture} alt={user.name} style={{ width: 32, height: 32, borderRadius: '50%' }} />
        <span>{user.name}</span>
      </header>
      <ChatContent />
    </div>
  );
};

export default function WrappedChatPage() {
  return (
    <AuthProvider>
      <ChatPage />
    </AuthProvider>
  );
}
