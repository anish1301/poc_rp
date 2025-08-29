import React from 'react';
import { ChatProvider } from './context/ChatContext';
import ChatInterface from './components/ChatInterface';
import OrderStatus from './components/OrderStatus';
import './App.css';

function App() {
  return (
    <div className="App">
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
    </div>
  );
}

export default App;
