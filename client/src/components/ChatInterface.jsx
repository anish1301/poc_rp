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
    orderStatus,
    dispatch
  } = useChat();

  const { showSuccess, showError, showInfo } = useNotification();

  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const hasAddedGreeting = useRef(false);
  const notifiedMessageIds = useRef(new Set()); // Track which messages we've shown notifications for

  // Add initial greeting when component mounts
  useEffect(() => {
    // Only add greeting if no messages exist at all AND we haven't added greeting yet
    if (messages.length === 0 && !hasAddedGreeting.current && dispatch) {
      const greetingMessage = {
        role: 'assistant',
        content: 'Hello! I am Order Buddy. How can I help you today?',
        timestamp: new Date().toISOString(),
        metadata: {
          isGreeting: true
        }
      };
      
      // Add greeting message using dispatch
      dispatch({ type: 'ADD_MESSAGE', payload: greetingMessage });
      hasAddedGreeting.current = true;
    }
  }, [messages.length, dispatch]); // Add messages.length as dependency

  // Show connection notification only once per session
  useEffect(() => {
    const hasShownNotification = sessionStorage.getItem('connectionNotificationShown');
    if (isConnected && !hasShownNotification) {
      showSuccess('🔗 Connected to server', 3000);
      sessionStorage.setItem('connectionNotificationShown', 'true');
    }
  }, [isConnected, showSuccess]);

  // Show notifications only for new messages with specific events
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      
      // Skip if we've already shown notification for this message
      if (notifiedMessageIds.current.has(lastMessage.id)) {
        return;
      }
      
      // Skip notifications for greeting messages
      if (lastMessage.metadata?.isGreeting) {
        return;
      }
      
      // Only show notifications for assistant messages with specific events
      if (lastMessage.role === 'assistant' && lastMessage.content) {
        let shouldNotify = false;
        
        // Order cancellation success
        if (lastMessage.content.includes('successfully cancelled')) {
          showSuccess('✅ Order cancelled successfully!', 5000);
          shouldNotify = true;
        }
        // Order shipped
        else if (lastMessage.content.includes('has been shipped')) {
          showInfo('📦 Order shipped!', 4000);
          shouldNotify = true;
        }
        // Order delivered
        else if (lastMessage.content.includes('delivered')) {
          showSuccess('✅ Order delivered!', 4000);
          shouldNotify = true;
        }
        // Order status update
        else if (lastMessage.metadata?.orderUpdate) {
          showInfo('📦 Order status updated!', 3000);
          shouldNotify = true;
        }
        // Error messages
        else if (lastMessage.metadata?.error) {
          showError('❌ ' + lastMessage.content, 5000);
          shouldNotify = true;
        }
        
        // Mark this message as notified if we showed a notification
        if (shouldNotify) {
          notifiedMessageIds.current.add(lastMessage.id);
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
      await sendMessage(inputMessage);
      // No need to show notification here - it will be handled by the message useEffect
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

  // Quick action buttons
  const quickActions = [
    { 
      id: 'cancel-order', 
      text: '❌ Cancel Order', 
      message: 'I want to cancel my order',
      color: '#ef4444'
    },
    { 
      id: 'track-order', 
      text: '📦 Track Order', 
      message: 'Track my order',
      color: '#3b82f6'
    },
    { 
      id: 'refund-status', 
      text: '💰 Refund Status', 
      message: 'What is my refund status?',
      color: '#f59e0b'
    },
    { 
      id: 'show-orders', 
      text: '📋 Show All Orders', 
      message: 'Show me my orders',
      color: '#10b981'
    },
    { 
      id: 'customer-executive', 
      text: '👨‍💼 Connect Executive', 
      message: 'I want to speak with a customer executive',
      color: '#8b5cf6'
    }
  ];

  const handleQuickAction = async (action) => {
    if (isLoading) return;
    
    setIsLoading(true);
    await sendMessage(action.message);
    setIsLoading(false);
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
          <h2>💬 Chat Assistant</h2>
          <p className="header-subtitle">Ask me about your orders, cancellations, and more</p>
        </div>
        
        <div className="header-actions">
          <div className="connection-status">
            <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '🟢 Online' : '🔴 Offline'}
            </span>
          </div>
          <button onClick={handleClearChat} className="clear-btn">
            🗑️ Clear Chat
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="messages-container">
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
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-banner">
          <span>⚠️ {error}</span>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {/* Quick Actions - above input */}
      <div className="quick-actions-compact">
        <div className="quick-actions-grid">
          {quickActions.map((action) => (
            <button
              key={action.id}
              onClick={() => handleQuickAction(action)}
              disabled={isLoading || !isConnected}
              className="quick-action-btn-compact"
              style={{ '--action-color': action.color }}
            >
              {action.text}
            </button>
          ))}
        </div>
      </div>

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
