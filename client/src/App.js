import React, { useState } from 'react';
import { ChatProvider } from './context/ChatContext';
import { NotificationProvider } from './context/NotificationContext';
import ChatInterface from './components/ChatInterface';
import OrderStatus from './components/OrderStatus';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="App">
      <NotificationProvider>
        <ChatProvider>
          <div className="app-container">
            {/* Professional Header */}
            <header className="app-header">
              <div className="header-left">
                <h1 className="app-title">
                  <span className="app-icon">🤖</span>
                  Order Management Assistant
                </h1>
                <p className="app-subtitle">AI-powered customer service solution</p>
              </div>
            </header>

            {/* Tab Navigation */}
            <nav className="tab-navigation">
              <button
                className={`tab-button ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                <span className="tab-icon">💬</span>
                Chat Assistant
              </button>
              <button
                className={`tab-button ${activeTab === 'orders' ? 'active' : ''}`}
                onClick={() => setActiveTab('orders')}
              >
                <span className="tab-icon">📦</span>
                Order Management
              </button>
            </nav>

            {/* Tab Content */}
            <main className="tab-content">
              {activeTab === 'chat' && (
                <div className="tab-panel">
                  <ChatInterface />
                </div>
              )}
              {activeTab === 'orders' && (
                <div className="tab-panel">
                  <OrderStatus />
                </div>
              )}
            </main>
          </div>
        </ChatProvider>
      </NotificationProvider>
    </div>
  );
}

export default App;
