import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { useNotification } from '../context/NotificationContext';
import './ChatInterface.css';

const ChatInterface = () => {
  const {
    messages,
    isConnected,
    isTyping,
    error,
    sendMessage,
    clearConversation,
    conversationStats,
    orderStatus
  } = useChat();

  const { showSuccess, showError, showInfo } = useNotification();

  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Show notifications for connection status changes
  useEffect(() => {
    if (isConnected) {
      showSuccess('🔗 Connected to server', 3000);
    }
  }, [isConnected, showSuccess]);

  // Show notifications based on message metadata
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      
      // Show notifications for order updates and important events
      if (lastMessage.metadata?.orderUpdate) {
        showInfo('📦 Order status updated!', 4000);
      }
      
      if (lastMessage.metadata?.cached) {
        showInfo('⚡ Quick response from cache', 2000);
      }
      
      if (lastMessage.metadata?.error) {
        showError('❌ ' + lastMessage.content, 5000);
      }

      // Show notifications for successful actions
      if (lastMessage.role === 'assistant' && lastMessage.content) {
        if (lastMessage.content.includes('successfully cancelled')) {
          showSuccess('✅ Order cancelled successfully!\n\nYou will receive a refund within 3-5 business days.', 6000);
        } else if (lastMessage.content.includes('has been shipped')) {
          showInfo('📦 Order shipped!\n\nYour order is on its way to you.', 5000);
        } else if (lastMessage.content.includes('delivered')) {
          showSuccess('✅ Order delivered!\n\nEnjoy your purchase!', 5000);
        }
      }
    }
  }, [messages, showSuccess, showError, showInfo]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const result = await sendMessage(inputMessage);
      if (result) {
        // Message sent successfully - could show a subtle notification
        if (result.metadata?.cached) {
          showInfo('⚡ Fast response from cache!', 2000);
        }
      }
    } catch (error) {
      showError('Failed to send message. Please try again.', 4000);
    }
    setInputMessage('');
    setIsLoading(false);
  };

  const handleClearChat = async () => {
    if (window.confirm('Are you sure you want to clear the conversation?')) {
      await clearConversation();
      showInfo('🗑️ Conversation cleared', 3000);
    }
  };

  // Suggested messages for quick interaction
  const suggestedMessages = [
    'Show me my orders',
    'Order status',
    'What is my refund status?',
    'Track my order',
    'Cancel order',
    'Cancel my order ORD-2024-001',
    'Status of Bluetooth Earphones'
  ];

  const handleSuggestedMessage = (message) => {
    setInputMessage(message);
  };

  const handleButtonClick = async (button) => {
    if (isLoading) return;
    
    setIsLoading(true);
    
    // Send the button value directly - let backend handle the parsing
    await sendMessage(button.value);
    
    setIsLoading(false);
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getMessageIcon = (role, metadata) => {
    switch (role) {
      case 'user':
        return '👤';
      case 'assistant':
        return '🤖';
      case 'system':
        return metadata?.error ? '⚠️' : 'ℹ️';
      default:
        return '💬';
    }
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return '#4CAF50'; // Green
    if (confidence >= 0.6) return '#FF9800'; // Orange
    return '#F44336'; // Red
  };

  const getRiskScoreColor = (riskScore) => {
    if (riskScore <= 25) return '#4CAF50'; // Green
    if (riskScore <= 50) return '#FF9800'; // Orange
    if (riskScore <= 75) return '#FF5722'; // Deep Orange
    return '#F44336'; // Red
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="header-content">
          <h1>Order Management Assistant</h1>
          <div className="connection-status">
            <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
            </span>
          </div>
        </div>
        
        {/* Stats Bar */}
        <div className="stats-bar">
          <div className="stat">
            <span className="stat-label">Messages:</span>
            <span className="stat-value">{conversationStats.totalMessages}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Cache Hits:</span>
            <span className="stat-value">{conversationStats.cacheHits}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Avg Response:</span>
            <span className="stat-value">{conversationStats.avgResponseTime}ms</span>
          </div>
          <button onClick={handleClearChat} className="clear-btn">
            Clear Chat
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="welcome-message">
            <h2>👋 Welcome to Order Management Chat</h2>
            <p>I can help you with order cancellations, status checks, and general inquiries.</p>
            <div className="suggested-messages">
              <h3>Try these examples:</h3>
              {suggestedMessages.map((message, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestedMessage(message)}
                  className="suggested-message-btn"
                >
                  {message}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <div className="message-header">
                  <span className="message-icon">
                    {getMessageIcon(message.role, message.metadata)}
                  </span>
                  <span className="message-role">{message.role}</span>
                  <span className="message-time">
                    {formatTimestamp(message.timestamp)}
                  </span>
                  
                  {/* Metadata badges */}
                  {message.metadata?.cached && (
                    <span className="badge cached">Cached</span>
                  )}
                  {message.metadata?.error && (
                    <span className="badge error">Error</span>
                  )}
                  {message.metadata?.orderUpdate && (
                    <span className="badge order-update">Order Update</span>
                  )}
                </div>
                
                <div className="message-content">
                  {message.content}
                  
                  {/* Clickable buttons for order selection */}
                  {message.buttons && message.showAsButtons && (
                    <div className="message-buttons">
                      {message.buttons.map((button, buttonIndex) => (
                        <button
                          key={buttonIndex}
                          className="order-button"
                          onClick={() => handleButtonClick(button)}
                          disabled={isLoading}
                        >
                          {button.text}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Order ID highlight */}
                  {message.metadata?.orderId && (
                    <div className="order-info">
                      <strong>Order ID:</strong> {message.metadata.orderId}
                      {orderStatus[message.metadata.orderId] && (
                        <span className={`order-status ${orderStatus[message.metadata.orderId]}`}>
                          - {orderStatus[message.metadata.orderId].replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  )}
                  
                  {/* AI Confidence and Risk Score */}
                  {message.role === 'assistant' && message.metadata && (
                    <div className="ai-metadata">
                      {message.metadata.confidence !== undefined && (
                        <div 
                          className="confidence-indicator"
                          style={{ color: getConfidenceColor(message.metadata.confidence) }}
                        >
                          Confidence: {(message.metadata.confidence * 100).toFixed(0)}%
                        </div>
                      )}
                      {message.metadata.riskScore !== undefined && message.metadata.riskScore > 0 && (
                        <div 
                          className="risk-indicator"
                          style={{ color: getRiskScoreColor(message.metadata.riskScore) }}
                        >
                          Risk Score: {message.metadata.riskScore}
                        </div>
                      )}
                      {message.metadata.responseTime && (
                        <div className="response-time">
                          Response Time: {message.metadata.responseTime}ms
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {/* Typing indicator */}
            {isTyping && (
              <div className="message assistant typing">
                <div className="message-header">
                  <span className="message-icon">🤖</span>
                  <span className="message-role">assistant</span>
                </div>
                <div className="message-content">
                  <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-banner">
          <span>⚠️ {error}</span>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="input-form">
        <div className="input-container">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type your message here... (e.g., 'Cancel my order #12345')"
            disabled={isLoading || !isConnected}
            maxLength={1000}
            className="message-input"
          />
          <button
            type="submit"
            disabled={isLoading || !isConnected || !inputMessage.trim()}
            className="send-button"
          >
            {isLoading ? '⏳' : '➤'}
          </button>
        </div>
        <div className="input-info">
          <span className="char-count">
            {inputMessage.length}/1000 characters
          </span>
          {!isConnected && (
            <span className="connection-warning">
              Disconnected - messages cannot be sent
            </span>
          )}
        </div>
      </form>
    </div>
  );
};

export default ChatInterface;
