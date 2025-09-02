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
    socket,
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
      
      // Only show notifications for assistant messages with ACTUAL state changes confirmed by metadata
      // This prevents notifications from showing when just asking questions about orders
      if (lastMessage.role === 'assistant' && lastMessage.content) {
        let shouldNotify = false;
        
        // ONLY show notifications when there are actual state changes confirmed by metadata
        // This prevents notifications from showing when just asking questions about orders
        
        // Order cancelled - only when confirmed via metadata (actual cancellation happened)
        if (lastMessage.metadata?.orderCancelled || 
            lastMessage.metadata?.action === 'order_cancelled' ||
            (lastMessage.metadata?.confirmed && lastMessage.content.toLowerCase().includes('cancelled successfully'))) {
          showSuccess('✅ Order cancelled successfully!', 5000);
          shouldNotify = true;
        }
        // Order status changed - only when metadata confirms actual state change
        else if (lastMessage.metadata?.orderStatusChanged || lastMessage.metadata?.stateChange) {
          const status = lastMessage.metadata?.newStatus || 'updated';
          if (status === 'shipped') {
            showInfo('📦 Order shipped!', 4000);
          } else if (status === 'delivered') {
            showSuccess('✅ Order delivered!', 4000);
          } else if (status === 'cancelled') {
            showSuccess('✅ Order cancelled!', 4000);
          } else {
            showInfo('📦 Order status updated!', 3000);
          }
          shouldNotify = true;
        }
        // Real-time WebSocket notifications (from actual backend state changes)
        else if (lastMessage.metadata?.websocketEvent || lastMessage.metadata?.realTimeUpdate) {
          const eventType = lastMessage.metadata?.eventType;
          if (eventType === 'order_cancelled') {
            showSuccess('✅ Order cancelled successfully!', 4000);
          } else if (eventType === 'order_shipped') {
            showInfo('📦 Order shipped!', 4000);
          } else if (eventType === 'order_delivered') {
            showSuccess('✅ Order delivered!', 4000);
          } else {
            showInfo('📦 Order updated!', 3000);
          }
          shouldNotify = true;
        }
        // Error messages - only if metadata indicates it's an actual error (not just asking questions)
        else if (lastMessage.metadata?.error && lastMessage.metadata?.isError) {
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

  // Listen for real-time order status updates via WebSocket
  useEffect(() => {
    if (socket) {
      // Listen for order cancellation events
      const handleOrderCancelled = (data) => {
        console.log('WebSocket: Order cancelled:', data);
        showSuccess(`✅ Order ${data.orderId} cancelled successfully!`, 5000);
      };

      // Listen for order shipped events  
      const handleOrderShipped = (data) => {
        console.log('WebSocket: Order shipped:', data);
        showInfo(`📦 Order ${data.orderId} has been shipped!`, 4000);
      };

      // Listen for order delivered events
      const handleOrderDelivered = (data) => {
        console.log('WebSocket: Order delivered:', data);
        showSuccess(`✅ Order ${data.orderId} has been delivered!`, 4000);
      };

      // Listen for generic order status updates
      const handleOrderStatusUpdate = (data) => {
        console.log('WebSocket: Order status updated:', data);
        const { orderId, oldStatus, newStatus } = data;
        
        if (newStatus === 'shipped') {
          showInfo(`📦 Order ${orderId} has been shipped!`, 4000);
        } else if (newStatus === 'delivered') {
          showSuccess(`✅ Order ${orderId} has been delivered!`, 4000);
        } else if (newStatus === 'cancelled') {
          showSuccess(`✅ Order ${orderId} has been cancelled!`, 4000);
        } else if (newStatus === 'confirmed') {
          showInfo(`✅ Order ${orderId} has been confirmed!`, 3000);
        } else if (newStatus === 'processing') {
          showInfo(`🔄 Order ${orderId} is now being processed!`, 3000);
        } else {
          showInfo(`📦 Order ${orderId} status updated: ${oldStatus} → ${newStatus}`, 3000);
        }
      };

      // Add event listeners
      socket.on('order_cancelled', handleOrderCancelled);
      socket.on('order_shipped', handleOrderShipped);
      socket.on('order_delivered', handleOrderDelivered);
      socket.on('order_status_update', handleOrderStatusUpdate);

      // Cleanup listeners on unmount
      return () => {
        socket.off('order_cancelled', handleOrderCancelled);
        socket.off('order_shipped', handleOrderShipped);
        socket.off('order_delivered', handleOrderDelivered);
        socket.off('order_status_update', handleOrderStatusUpdate);
      };
    }
  }, [socket, showSuccess, showError, showInfo]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const formatMarkdown = (text) => {
    // Convert **text** to bold
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  };

  const formatMessageContent = (content) => {
    return content.split('\n').map((line, index) => (
      <React.Fragment key={index}>
        <span dangerouslySetInnerHTML={{ __html: formatMarkdown(line) }} />
        {index < content.split('\n').length - 1 && <br />}
      </React.Fragment>
    ));
  };

  const getOrderStatusDisplay = (status) => {
    if (!status || status === 'unknown') return null;
    
    const statusDisplayMap = {
      'pending': 'Pending',
      'confirmed': 'Confirmed', 
      'processing': 'Processing',
      'shipped': 'Shipped',
      'delivered': 'Delivered',
      'cancelled': 'Cancelled',
      'refund_pending': 'Refund Pending',
      'refunded': 'Refunded'
    };
    
    return statusDisplayMap[status] || status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
  };

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
                  {/* Format message content with proper line breaks and Markdown formatting */}
                  <div className="message-text">
                    {formatMessageContent(message.content)}
                  </div>
                  
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
                      {orderStatus[message.metadata.orderId] && 
                       getOrderStatusDisplay(orderStatus[message.metadata.orderId]) && (
                        <span className={`order-status ${orderStatus[message.metadata.orderId]}`}>
                          - {getOrderStatusDisplay(orderStatus[message.metadata.orderId])}
                        </span>
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
