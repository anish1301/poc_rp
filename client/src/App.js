import React from 'react';
import { ChatProvider } from './context/ChatContext';
import { NotificationProvider } from './context/NotificationContext';
import ChatInterface from './components/ChatInterface';
import OrderStatus from './components/OrderStatus';
import './App.css';

function App() {
  return (
    <div className="App">
      <NotificationProvider>
        <ChatProvider>
          <div className="app-layout">
            <main className="chat-main">
              <ChatInterface />
            </main>
            <aside className="order-sidebar">
              <OrderStatus />
            </aside>
          </div>
        </ChatProvider>
      </NotificationProvider>
    </div>
  );
}

export default App;
