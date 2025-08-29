import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
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

  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    setIsLoading(true);
    await sendMessage(inputMessage);
    setInputMessage('');
    setIsLoading(false);
  };

  const handleClearChat = async () => {
    if (window.confirm('Are you sure you want to clear the conversation?')) {
      await clearConversation();
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
    
    // Send the button value as a message based on action type
    if (button.action === 'order_selected') {
      await sendMessage(`Order status for ${button.value}`);
    } else if (button.action === 'refund_selected') {
      if (button.value === 'refund_all') {
        await sendMessage('Show all refund statuses');
      } else {
        const orderId = button.value.replace('refund_', '');
        await sendMessage(`Refund status for ${orderId}`);
      }
    } else if (button.action === 'track_selected') {
      const orderId = button.value.replace('track_', '');
      await sendMessage(`Show tracking details for order ${orderId}`);
    } else if (button.action === 'cancel_order_selected') {
      // Extract order ID from button value and send clear cancellation request
      const orderId = button.value.replace('cancel_', '');
      await sendMessage(`Cancel order ${orderId}`);
    } else if (button.action === 'confirm_cancellation') {
      // Send the button value for confirmation
      await sendMessage(button.value);
    } else if (button.action === 'cancel_abort') {
      // Send abort message
      await sendMessage('No, keep my order');
    } else {
      // Generic button click - send the button text or value
      await sendMessage(button.text || button.value);
    }
    
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
