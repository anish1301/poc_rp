import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import io from 'socket.io-client';

// API base URL - uses environment variable or fallback to localhost
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

// Initial state
const initialState = {
  sessionId: null,
  userId: 'CUST-001', // Use consistent customer ID that matches database
  messages: [],
  isConnected: false,
  isTyping: false,
  error: null,
  socket: null,
  orderStatus: {},
  conversationStats: {
    totalMessages: 0,
    cacheHits: 0,
    avgResponseTime: 0
  }
};

// Action types
const actionTypes = {
  SET_SESSION_ID: 'SET_SESSION_ID',
  ADD_MESSAGE: 'ADD_MESSAGE',
  SET_TYPING: 'SET_TYPING',
  SET_CONNECTION: 'SET_CONNECTION',
  SET_ERROR: 'SET_ERROR',
  SET_SOCKET: 'SET_SOCKET',
  UPDATE_ORDER_STATUS: 'UPDATE_ORDER_STATUS',
  UPDATE_STATS: 'UPDATE_STATS',
  CLEAR_MESSAGES: 'CLEAR_MESSAGES'
};

// Reducer
const chatReducer = (state, action) => {
  switch (action.type) {
    case actionTypes.SET_SESSION_ID:
      return { ...state, sessionId: action.payload };
    
    case actionTypes.ADD_MESSAGE:
      return {
        ...state,
        messages: [...state.messages, { ...action.payload, id: uuidv4() }],
        conversationStats: {
          ...state.conversationStats,
          totalMessages: state.conversationStats.totalMessages + 1
        }
      };
    
    case actionTypes.SET_TYPING:
      return { ...state, isTyping: action.payload };
    
    case actionTypes.SET_CONNECTION:
      return { ...state, isConnected: action.payload };
    
    case actionTypes.SET_ERROR:
      return { ...state, error: action.payload };
    
    case actionTypes.SET_SOCKET:
      return { ...state, socket: action.payload };
    
    case actionTypes.UPDATE_ORDER_STATUS:
      return {
        ...state,
        orderStatus: {
          ...state.orderStatus,
          [action.payload.orderId]: action.payload.status
        }
      };
    
    case actionTypes.UPDATE_STATS:
      return {
        ...state,
        conversationStats: {
          ...state.conversationStats,
          cacheHits: action.payload.incrementCache ? 
            state.conversationStats.cacheHits + 1 : 
            (action.payload.cacheHits !== undefined ? action.payload.cacheHits : state.conversationStats.cacheHits),
          avgResponseTime: action.payload.avgResponseTime !== undefined ? 
            action.payload.avgResponseTime : state.conversationStats.avgResponseTime
        }
      };
    
    case actionTypes.CLEAR_MESSAGES:
      return {
        ...state,
        messages: [],
        conversationStats: { ...initialState.conversationStats }
      };
    
    default:
      return state;
  }
};

// Create context
const ChatContext = createContext();

// Custom hook to use chat context
export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};

// Chat provider component
export const ChatProvider = ({ children }) => {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  // Initialize session and socket connection
  useEffect(() => {
    // Generate session ID
    const sessionId = 'session_' + uuidv4();
    dispatch({ type: actionTypes.SET_SESSION_ID, payload: sessionId });

    // Initialize socket connection
    const socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('Connected to server');
      dispatch({ type: actionTypes.SET_CONNECTION, payload: true });
      
      // Join session room
      socket.emit('join-session', sessionId);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      dispatch({ type: actionTypes.SET_CONNECTION, payload: false });
    });

    // Listen for real-time message responses
    socket.on('message_response', (response) => {
      console.log('Real-time response:', response);
      
      // Update stats if available
      if (response.metadata) {
        dispatch({
          type: actionTypes.UPDATE_STATS,
          payload: {
            incrementCache: response.metadata.cached || false,
            avgResponseTime: response.metadata.totalResponseTime
          }
        });
      }
    });

    // Listen for order status updates
    socket.on('order_cancelled', (data) => {
      console.log('Order cancelled:', data);
      dispatch({
        type: actionTypes.UPDATE_ORDER_STATUS,
        payload: { orderId: data.orderId, status: data.status }
      });
      
      // Add system message
      dispatch({
        type: actionTypes.ADD_MESSAGE,
        payload: {
          role: 'system',
          content: `Order ${data.orderId} has been successfully cancelled.`,
          timestamp: new Date().toISOString(),
          metadata: { orderUpdate: true }
        }
      });
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      dispatch({ type: actionTypes.SET_ERROR, payload: 'Connection failed' });
    });

    dispatch({ type: actionTypes.SET_SOCKET, payload: socket });

    // Cleanup on unmount
    return () => {
      socket.close();
    };
  }, []); // Added empty dependency array

  // Send message function
  const sendMessage = async (message) => {
    if (!message.trim() || !state.sessionId) return null;

    // Add user message to chat immediately
    const userMessage = {
      role: 'user',
      content: message.trim(),
      timestamp: new Date().toISOString()
    };

    dispatch({ type: actionTypes.ADD_MESSAGE, payload: userMessage });
    dispatch({ type: actionTypes.SET_TYPING, payload: true });
    dispatch({ type: actionTypes.SET_ERROR, payload: null });

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': state.sessionId
        },
        body: JSON.stringify({
          message: message.trim(),
          sessionId: state.sessionId,
          userId: state.userId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send message');
      }

      const aiResponse = await response.json();

      // Add AI response to chat
      const assistantMessage = {
        role: 'assistant',
        content: aiResponse.message,
        timestamp: new Date().toISOString(),
        buttons: aiResponse.buttons || null,
        showAsButtons: aiResponse.showAsButtons || false,
        metadata: {
          action: aiResponse.action,
          orderId: aiResponse.orderId,
          confidence: aiResponse.confidence,
          cached: aiResponse.metadata?.cached || false,
          responseTime: aiResponse.metadata?.totalResponseTime || 0,
          riskScore: aiResponse.metadata?.riskScore || 0
        }
      };

      dispatch({ type: actionTypes.ADD_MESSAGE, payload: assistantMessage });

      // Update stats
      dispatch({
        type: actionTypes.UPDATE_STATS,
        payload: {
          incrementCache: aiResponse.metadata?.cached || false,
          avgResponseTime: aiResponse.metadata?.totalResponseTime || 0
        }
      });

      // Update order status if relevant and we can determine a meaningful status
      if (aiResponse.orderId && aiResponse.action) {
        let orderStatus = null;
        
        // Determine status based on AI response action
        if (aiResponse.action === 'order_cancellation') {
          orderStatus = 'pending_cancellation';
        } else if (aiResponse.action === 'order_cancelled') {
          orderStatus = 'cancelled';
        } else if (aiResponse.action === 'status_check') {
          // Try to extract status from the response message using better patterns
          const statusPatterns = [
            /status[:\s]+(\w+)/i,
            /is currently (\w+)/i,
            /has been (\w+)/i,
            /order (\w+)/i
          ];
          
          for (const pattern of statusPatterns) {
            const match = aiResponse.message.match(pattern);
            if (match && match[1] && !['check', 'your', 'the', 'and', 'with'].includes(match[1].toLowerCase())) {
              orderStatus = match[1].toLowerCase();
              break;
            }
          }
        }
        
        // Only update if we found a meaningful status
        if (orderStatus) {
          dispatch({
            type: actionTypes.UPDATE_ORDER_STATUS,
            payload: { orderId: aiResponse.orderId, status: orderStatus }
          });
        }
      }

      return aiResponse;

    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message to chat
      dispatch({
        type: actionTypes.ADD_MESSAGE,
        payload: {
          role: 'system',
          content: `Error: ${error.message}`,
          timestamp: new Date().toISOString(),
          metadata: { error: true }
        }
      });

      dispatch({ type: actionTypes.SET_ERROR, payload: error.message });
      return null;
    } finally {
      dispatch({ type: actionTypes.SET_TYPING, payload: false });
    }
  };

  // Get conversation history
  const getConversationHistory = async () => {
    if (!state.sessionId) return [];

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/history/${state.sessionId}?userId=${state.userId}`);
      if (response.ok) {
        const data = await response.json();
        return data.messages || [];
      }
    } catch (error) {
      console.error('Error fetching conversation history:', error);
    }
    return [];
  };

  // Clear conversation
  const clearConversation = async () => {
    try {
      if (state.sessionId) {
        await fetch(`${API_BASE_URL}/api/chat/context/${state.sessionId}?userId=${state.userId}`, {
          method: 'DELETE'
        });
      }
      dispatch({ type: actionTypes.CLEAR_MESSAGES });
    } catch (error) {
      console.error('Error clearing conversation:', error);
    }
  };

  // Get order details
  const getOrderDetails = async (orderId) => {
    if (!orderId) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/${orderId}?userId=${state.userId}`, {
        headers: {
          'X-Session-ID': state.sessionId
        }
      });

      if (response.ok) {
        return await response.json();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch order details');
      }
    } catch (error) {
      console.error('Error fetching order details:', error);
      return null;
    }
  };

  // Seed test orders for development
  const seedTestOrders = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/seed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: state.userId,
          count: 3
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Test orders created:', data.orders);
        
        // Add these orders to our tracking
        data.orders.forEach(order => {
          dispatch({
            type: actionTypes.UPDATE_ORDER_STATUS,
            payload: { orderId: order.orderId, status: order.status }
          });
        });
        
        return data.orders;
      }
    } catch (error) {
      console.error('Error seeding test orders:', error);
    }
    return [];
  };

  // Update order status manually
  const updateOrderStatus = (orderId, status) => {
    dispatch({
      type: actionTypes.UPDATE_ORDER_STATUS,
      payload: { orderId, status }
    });
  };

  // Context value
  const value = {
    ...state,
    sendMessage,
    getConversationHistory,
    clearConversation,
    getOrderDetails,
    seedTestOrders,
    updateOrderStatus,
    dispatch
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};
