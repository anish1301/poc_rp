const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Import services
const aiService = require('../services/aiService');
const contextService = require('../services/contextService');
const actionValidator = require('../services/actionValidator');
const cacheService = require('../services/cacheService');
const AuditLog = require('../models/AuditLog');
const { MongoClient } = require('mongodb');

// Helper function to handle confirmation responses
async function handleConfirmationResponse(message, context, userId, io) {
  const lowerMessage = message.toLowerCase().trim();
  
  // Check if this looks like a confirmation
  const isConfirmation = /^(yes|yeah|y|confirm|ok|okay|sure|proceed|do it|go ahead)$/i.test(lowerMessage);
  const isDenial = /^(no|nope|n|cancel|abort|stop|never mind|nevermind)$/i.test(lowerMessage);
  
  if (!isConfirmation && !isDenial) {
    return { handled: false };
  }

  // Look for pending cancellation orders in recent conversation
  const pendingOrders = [];
  if (context.conversationHistory) {
    for (let i = context.conversationHistory.length - 1; i >= Math.max(0, context.conversationHistory.length - 5); i--) {
      const msg = context.conversationHistory[i];
      if (msg.role === 'assistant' && msg.content && msg.content.includes('confirm')) {
        const orderIdMatch = msg.content.match(/order\s+(ORD-\d{4}-\d{3})/i);
        if (orderIdMatch) {
          pendingOrders.push(orderIdMatch[1]);
        }
      }
    }
  }

  if (pendingOrders.length === 0) {
    return { handled: false };
  }

  const orderId = pendingOrders[0]; // Use most recent pending order

  if (isDenial) {
    return {
      handled: true,
      action: 'cancellation_denied',
      orderId: orderId,
      message: `Understood. I won't cancel order ${orderId}. Is there anything else I can help you with?`
    };
  }

  if (isConfirmation) {
    try {
      // Actually cancel the order by calling the order controller endpoint
      const orderController = require('./orderController');
      
      // Create a mock request/response to call the cancellation endpoint
      const mockReq = {
        params: { orderId },
        body: { userId, reason: 'Customer requested cancellation via chat' },
        app: { get: () => io } // Pass IO for WebSocket notifications
      };
      
      const mockRes = {
        json: (data) => data,
        status: (code) => ({ json: (data) => ({ status: code, ...data }) })
      };

      // Call the cancellation endpoint
      const result = await new Promise((resolve, reject) => {
        mockRes.json = resolve;
        mockRes.status = (code) => ({ json: (data) => resolve({ status: code, ...data }) });
        
        // Import and call the cancel order function
        const cancelOrder = require('./orderController');
        // We'll need to extract the cancel logic or call it directly
        
        // For now, let's do the cancellation directly here
        performOrderCancellation(orderId, userId, 'Customer requested cancellation via chat', io)
          .then(resolve)
          .catch(reject);
      });

      return {
        handled: true,
        action: 'order_cancelled',
        orderId: orderId,
        message: `Perfect! I've successfully cancelled order ${orderId}. You should see the updated status shortly.`
      };

    } catch (error) {
      console.error('Error cancelling order:', error);
      return {
        handled: true,
        action: 'cancellation_failed',
        orderId: orderId,
        message: `I'm sorry, but I encountered an error while cancelling order ${orderId}. Please try again or contact customer support.`
      };
    }
  }

  return { handled: false };
}

// Helper function to perform actual order cancellation
async function performOrderCancellation(orderId, userId, reason, io) {
  const { MongoClient } = require('mongodb');
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/poc-rp-db?authSource=admin';
  
  let client;
  try {
    client = new MongoClient(mongoUrl);
    await client.connect();
    const db = client.db('poc-rp-db');
    const ordersCollection = db.collection('orders');

    // Update the order status
    const updateResult = await ordersCollection.updateOne(
      { orderId: orderId },
      { 
        $set: { 
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      // Emit WebSocket event for real-time updates
      if (io) {
        io.emit('order_cancelled', {
          orderId: orderId,
          status: 'cancelled',
          timestamp: new Date().toISOString()
        });
      }

      return { success: true, orderId };
    } else {
      throw new Error('Order not found or already cancelled');
    }

  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Chat-specific rate limiting
const chatRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 messages per minute per IP
  message: { error: 'Too many messages, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * MAIN CHAT ENDPOINT - Handles the complete chat flow with caching and validation
 */
router.post('/message', chatRateLimit, async (req, res) => {
  const startTime = Date.now();
  let auditData = {
    sessionId: req.body.sessionId,
    userId: req.body.userId,
    action: 'ai_response_generated',
    orderId: null,
    details: {
      userMessage: req.body.message,
      performanceMetrics: {}
    },
    result: 'success'
  };

  try {
    // Validate request
    const { message, sessionId, userId } = req.body;
    
    if (!message || !sessionId || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: message, sessionId, userId'
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({
        error: 'Message too long (max 1000 characters)'
      });
    }

    // Get conversation context
    const context = await contextService.getConversationContext(sessionId, userId);
    
    // Check rate limiting at user level
    const rateLimitResult = await cacheService.checkRateLimit(userId, 100, 3600);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        resetTime: rateLimitResult.resetTime,
        retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
      });
    }

    // Check if this is a confirmation response for a pending action
    const confirmationResult = await handleConfirmationResponse(message, context, userId, req.app.get('io'));
    if (confirmationResult.handled) {
      auditData.orderId = confirmationResult.orderId;
      auditData.details.confirmationAction = confirmationResult.action;
      auditData.details.performanceMetrics.totalResponseTime = Date.now() - startTime;
      await AuditLog.logAction(auditData);
      
      return res.json({
        action: confirmationResult.action,
        orderId: confirmationResult.orderId,
        confidence: 1.0,
        message: confirmationResult.message,
        requiresConfirmation: false,
        metadata: {
          confirmed: true,
          timestamp: new Date().toISOString(),
          sessionId
        }
      });
    }

    // Check for button clicks first (track, cancel, refund actions)
    const buttonAction = detectButtonAction(message);
    console.log(`[DEBUG] Button action detected:`, buttonAction);
    if (buttonAction) {
      console.log(`[DEBUG] Processing button action: ${buttonAction.action} for ${buttonAction.orderId || buttonAction.value}`);
      let buttonResponse;
      
      switch (buttonAction.action) {
        case 'track_selected':
          buttonResponse = await handleSpecificOrderTracking(userId, {
            action: 'track_specific_order',
            orderId: buttonAction.orderId,
            confidence: 1.0,
            message: `Getting tracking details for order ${buttonAction.orderId}...`
          });
          break;
        case 'order_selected':
          buttonResponse = await handleOrderStatusCheck(userId, {
            action: 'status_check',
            orderId: buttonAction.orderId,
            confidence: 1.0,
            message: `Getting details for order ${buttonAction.orderId}...`
          });
          break;
        case 'refund_selected':
          if (buttonAction.value === 'refund_all') {
            buttonResponse = await handleRefundStatus(userId, {
              action: 'refund_status',
              confidence: 1.0,
              message: 'Getting all refund statuses...'
            });
          } else {
            buttonResponse = await handleRefundStatus(userId, {
              action: 'refund_status',
              orderId: buttonAction.orderId,
              confidence: 1.0,
              message: `Getting refund status for order ${buttonAction.orderId}...`
            });
          }
          break;
        case 'cancel_order_selected':
          buttonResponse = await handleOrderCancellation(userId, {
            action: 'order_cancellation',
            orderId: buttonAction.orderId,
            confidence: 1.0,
            message: `Processing cancellation request for order ${buttonAction.orderId}...`
          }, message, sessionId);
          break;
        case 'confirm_cancellation':
          buttonResponse = await handleConfirmCancellation(userId, {
            action: 'confirm_cancellation',
            orderId: buttonAction.orderId,
            confidence: 1.0,
            message: 'Processing confirmation...'
          }, message, sessionId);
          break;
        case 'cancel_abort':
          buttonResponse = await handleCancelAbort(userId, {
            action: 'cancel_abort',
            confidence: 1.0,
            message: 'Cancelling the cancellation request...'
          });
          break;
        default:
          buttonResponse = null;
      }
      
      if (buttonResponse) {
        // Add messages to conversation context
        await contextService.addMessage(sessionId, 'user', message, {
          actionType: buttonAction.action,
          orderId: buttonAction.orderId,
          confidence: 1.0,
          buttonClick: true
        });

        await contextService.addMessage(sessionId, 'assistant', buttonResponse.message, {
          actionType: buttonResponse.action,
          orderId: buttonResponse.orderId,
          cached: false,
          validated: true,
          buttonResponse: true
        });
        
        return res.json({
          ...buttonResponse,
          metadata: {
            totalResponseTime: Date.now() - startTime,
            buttonAction: true,
            sessionId,
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    // Check for direct product search patterns (fallback when AI quota is exceeded)
    const productSearchFallback = detectProductSearch(message);
    console.log(`[DEBUG] Product search fallback result:`, productSearchFallback);
    if (productSearchFallback) {
      console.log(`[DEBUG] Using product search fallback for: ${productSearchFallback.productName}`);
      const fallbackResponse = await handleProductStatusCheck(userId, {
        action: 'status_check',
        productName: productSearchFallback.productName,
        orderId: null,
        confidence: 0.85,
        message: `Searching for ${productSearchFallback.productName}...`
      });
      
      return res.json({
        ...fallbackResponse,
        metadata: {
          totalResponseTime: Date.now() - startTime,
          fallbackUsed: true,
          sessionId,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Process message with AI service
    const aiResponse = await aiService.processMessage(message, context, {
      sessionId,
      userId
    });

    auditData.orderId = aiResponse.orderId;
    auditData.details.aiResponse = aiResponse;
    auditData.details.performanceMetrics.aiResponseTime = aiResponse.metadata?.processingTime || 0;

    // If this is an order action, validate it
    let validationResult = null;
    if (['order_cancellation', 'status_check', 'list_orders', 'refund_status', 'track_order', 'cancel_orders', 'confirm_cancellation'].includes(aiResponse.action)) {
      console.log('[DEBUG] Chat Controller - Validating action:', aiResponse.action, 'for orderId:', aiResponse.orderId);
      
      validationResult = await actionValidator.validateAction(aiResponse, {
        userId,
        sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      console.log('[DEBUG] Validation result:', validationResult.isValid, 'reasons:', validationResult.reasons);
      // Format validationResult to match AuditLog schema
      auditData.details.validationResult = {
        passed: validationResult.isValid,
        reason: validationResult.reasons.join('; '),
        checks: validationResult.checks ? validationResult.checks.map(check => ({
          name: check.name,
          passed: check.passed,
          details: JSON.stringify(check.details) // Convert details object to string
        })) : []
      };
      
      // If validation failed, modify response
      if (!validationResult.isValid) {
        auditData.result = 'failure';
        auditData.details.errorMessage = validationResult.reasons.join('; ');
        
        return res.json({
          action: 'error',
          orderId: aiResponse.orderId,
          confidence: 0.0,
          message: `I'm sorry, but I can't proceed with this request: ${validationResult.reasons[0]}`,
          requiresConfirmation: false,
          metadata: {
            ...aiResponse.metadata,
            validated: false,
            validationReasons: validationResult.reasons,
            riskScore: validationResult.riskScore
          }
        });
      }
    }

    // Handle specific action types that require additional processing
    let enhancedResponse = { ...aiResponse };
    
    switch (aiResponse.action) {
      case 'list_orders':
        enhancedResponse = await handleListOrders(userId, aiResponse);
        break;
      case 'refund_status':
        enhancedResponse = await handleRefundStatus(userId, aiResponse);
        break;
      case 'track_order':
        enhancedResponse = await handleTrackOrder(userId, aiResponse);
        break;
      case 'track_specific_order':
        enhancedResponse = await handleSpecificOrderTracking(userId, aiResponse);
        break;
      case 'cancel_orders':
        enhancedResponse = await handleCancelOrders(userId, aiResponse);
        break;
      case 'order_cancellation':
        enhancedResponse = await handleOrderCancellation(userId, aiResponse, message, sessionId);
        break;
      case 'confirm_cancellation':
        enhancedResponse = await handleConfirmCancellation(userId, aiResponse, message, sessionId);
        break;
      case 'cancel_abort':
        enhancedResponse = await handleCancelAbort(userId, aiResponse);
        break;
      case 'status_check':
        console.log(`[DEBUG] Status check - orderId: ${aiResponse.orderId}, productName: ${aiResponse.productName}`);
        if (aiResponse.orderId) {
          enhancedResponse = await handleOrderStatusCheck(userId, aiResponse);
        } else if (aiResponse.productName) {
          console.log(`[DEBUG] Calling handleProductStatusCheck for product: ${aiResponse.productName}`);
          enhancedResponse = await handleProductStatusCheck(userId, aiResponse);
        }
        break;
      case 'clarification_needed':
        // Check if this is actually a common request that shouldn't need clarification
        const fallbackAction = detectFallbackAction(message);
        if (fallbackAction) {
          console.log(`[DEBUG] Converting clarification_needed to ${fallbackAction.action} for message: ${message}`);
          enhancedResponse = await processFallbackAction(userId, fallbackAction);
        } else if (aiResponse.productName) {
          // If clarification is needed but we have a product name, try product search
          console.log(`[DEBUG] Clarification needed but productName found: ${aiResponse.productName}, performing product search`);
          enhancedResponse = await handleProductStatusCheck(userId, aiResponse);
        }
        break;
    }

    // Add message to conversation context
    await contextService.addMessage(sessionId, 'user', message, {
      actionType: aiResponse.action,
      orderId: aiResponse.orderId,
      confidence: aiResponse.confidence
    });

    await contextService.addMessage(sessionId, 'assistant', enhancedResponse.message, {
      actionType: enhancedResponse.action,
      orderId: enhancedResponse.orderId,
      cached: enhancedResponse.metadata?.cached || false,
      validated: validationResult?.isValid || false
    });

    // Calculate total response time
    const totalResponseTime = Date.now() - startTime;
    auditData.details.performanceMetrics.totalResponseTime = totalResponseTime;

    // Emit real-time update if socket is available
    const io = req.app.get('io');
    if (io) {
      io.to(sessionId).emit('message_response', {
        ...enhancedResponse,
        timestamp: new Date().toISOString(),
        sessionId
      });
    }

    // Log successful interaction
    await AuditLog.logAction(auditData);

    // Return enhanced response
    res.json({
      ...enhancedResponse,
      metadata: {
        ...enhancedResponse.metadata,
        totalResponseTime,
        validated: validationResult?.isValid || true,
        riskScore: validationResult?.riskScore || 0,
        rateLimitRemaining: rateLimitResult.remaining,
        sessionId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Chat controller error:', error);
    
    // Log error
    auditData.result = 'failure';
    auditData.details.errorMessage = error.message;
    auditData.details.performanceMetrics.totalResponseTime = Date.now() - startTime;
    await AuditLog.logAction(auditData).catch(console.error);

    res.status(500).json({
      error: 'An error occurred processing your message',
      action: 'error',
      orderId: null,
      confidence: 0.0,
      message: 'I apologize, but I encountered an technical issue. Please try again in a moment.',
      requiresConfirmation: false,
      metadata: {
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal error',
        processingTime: Date.now() - startTime
      }
    });
  }
});

/**
 * Streaming chat endpoint for real-time responses
 */
router.post('/stream', chatRateLimit, async (req, res) => {
  const { message, sessionId, userId } = req.body;
  
  if (!message || !sessionId || !userId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Get conversation context
    const context = await contextService.getConversationContext(sessionId, userId);

    // Send initial acknowledgment
    res.write(`data: ${JSON.stringify({ type: 'start', message: 'Processing your request...' })}\n\n`);

    // Generate streaming response
    const streamGenerator = aiService.generateStreamingResponse(message, context);
    
    for await (const chunk of streamGenerator) {
      if (chunk.error) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
        break;
      }

      res.write(`data: ${JSON.stringify({ 
        type: 'chunk', 
        content: chunk.content,
        complete: chunk.complete 
      })}\n\n`);

      if (chunk.complete) {
        res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
        break;
      }
    }

    res.end();

  } catch (error) {
    console.error('Streaming error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Streaming failed' })}\n\n`);
    res.end();
  }
});

/**
 * Get conversation history
 */
router.get('/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const context = await contextService.getConversationContext(sessionId, userId);
    
    res.json({
      sessionId,
      messages: context.conversationHistory,
      context: context.context,
      status: context.status,
      lastUpdated: context.updatedAt
    });

  } catch (error) {
    console.error('Error getting conversation history:', error);
    res.status(500).json({ error: 'Failed to retrieve conversation history' });
  }
});

/**
 * Get conversation summary and analytics
 */
router.get('/summary/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messageLimit } = req.query;

    const summary = await contextService.getConversationSummary(
      sessionId, 
      parseInt(messageLimit) || 10
    );

    res.json(summary);

  } catch (error) {
    console.error('Error getting conversation summary:', error);
    res.status(500).json({ error: 'Failed to retrieve conversation summary' });
  }
});

/**
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const serviceStats = await aiService.getServiceStats();
    const cacheStats = await cacheService.getStats();
    const validationStats = await actionValidator.getValidationStats(1);

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        ai: {
          status: serviceStats.geminiHealth ? 'healthy' : 'degraded',
          cacheHitRatio: serviceStats.cacheStats.ai_cache_hit_ratio || '0.00'
        },
        cache: {
          status: cacheService.isReady() ? 'healthy' : 'down',
          hitRatio: cacheStats.cache_hit_ratio || '0.00'
        },
        validation: {
          status: 'healthy',
          successRate: validationStats.successRate || '0.00',
          avgResponseTime: validationStats.averageValidationTime || 0
        }
      },
      stats: {
        cache: cacheStats,
        validation: validationStats
      }
    });

  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Clear conversation context (for testing/debugging)
 */
router.delete('/context/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Clear from cache
    await cacheService.clearCache(`conv:${sessionId}`);
    
    // This would also clear from database if needed
    // await Conversation.findOneAndUpdate(
    //   { sessionId, userId },
    //   { status: 'ended' }
    // );

    res.json({ 
      message: 'Conversation context cleared',
      sessionId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error clearing context:', error);
    res.status(500).json({ error: 'Failed to clear conversation context' });
  }
});

/**
 * Handler for listing user's orders with clickable options
 */
async function handleListOrders(userId, aiResponse) {
  try {
    const mongoose = require('mongoose');
    
    // Ensure mongoose connection is active
    if (mongoose.connection.readyState !== 1) {
      console.log('[DEBUG] Mongoose disconnected, attempting reconnection...');
      const connectDB = require('../config/db');
      await connectDB();
    }
    
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not available');
    }
    
    const orders = await db.collection('orders')
      .find({ customerId: userId })
      .sort({ orderDate: -1 })
      .toArray();

    if (orders.length === 0) {
      return {
        ...aiResponse,
        message: "You don't have any orders yet. Feel free to browse our products!",
        buttons: []
      };
    }

    // Create clickable buttons for each order
    const buttons = orders.map((order, index) => ({
      text: `${order.items[0]?.name || 'Order'} - $${order.totalAmount} (${order.status})`,
      value: order.orderId,
      action: 'order_selected'
    }));

    console.log('[DEBUG] Generated', buttons.length, 'order buttons for user', userId);

    return {
      ...aiResponse,
      message: `Here are your recent orders. Click on any order for more details:`,
      buttons: buttons,
      showAsButtons: true
    };
  } catch (error) {
    console.error('Error fetching orders:', error);
    return {
      ...aiResponse,
      message: "I'm having trouble accessing your orders right now. A customer executive will reach out to you soon!"
    };
  }
}

/**
 * Handler for refund status requests
 */
async function handleRefundStatus(userId, aiResponse) {
  try {
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    const refundOrders = await db.collection('orders')
      .find({ 
        customerId: userId,
        $or: [
          { status: 'refund_pending' },
          { status: 'cancelled', paymentStatus: 'refunded' }
        ]
      })
      .sort({ orderDate: -1 })
      .toArray();

    if (refundOrders.length === 0) {
      return {
        ...aiResponse,
        message: "You don't have any orders currently in refund process."
      };
    }

    if (refundOrders.length === 1) {
      const order = refundOrders[0];
      return {
        ...aiResponse,
        message: `Your order for ${order.items[0]?.name} is currently being refunded. The amount $${order.totalAmount} will be returned to your bank account within 3-5 working days.`
      };
    }

    // Multiple refund orders - show options
    const buttons = refundOrders.map(order => ({
      text: `${order.items[0]?.name} - $${order.totalAmount} (${order.status})`,
      value: `refund_${order.orderId}`,
      action: 'refund_selected'
    }));

    // Add option to check all refunds
    buttons.push({
      text: "Check status for all refunds",
      value: "refund_all",
      action: 'refund_selected'
    });

    return {
      ...aiResponse,
      message: `You have ${refundOrders.length} orders in refund process. Which one would you like to check?`,
      buttons: buttons,
      showAsButtons: true
    };
  } catch (error) {
    console.error('Error fetching refund orders:', error);
    return {
      ...aiResponse,
      message: "I'm having trouble accessing your refund information. A customer executive will reach out to you soon!"
    };
  }
}

/**
 * Handler for order tracking requests
 */
async function handleTrackOrder(userId, aiResponse) {
  try {
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    const trackableOrders = await db.collection('orders')
      .find({ 
        customerId: userId,
        $or: [
          { status: 'shipped' },
          { status: 'delivered' }
        ]
      })
      .sort({ orderDate: -1 })
      .toArray();

    if (trackableOrders.length === 0) {
      return {
        ...aiResponse,
        message: "You don't have any orders that are currently trackable. Orders become trackable once they're shipped."
      };
    }

    if (trackableOrders.length === 1) {
      const order = trackableOrders[0];
      return generateTrackingInfo(order, aiResponse);
    }

    // Multiple trackable orders - show options
    const buttons = trackableOrders.map(order => ({
      text: `${order.items[0]?.name} - ${order.status}`,
      value: `track_${order.orderId}`,
      action: 'track_selected'
    }));

    return {
      ...aiResponse,
      message: `You have ${trackableOrders.length} orders that can be tracked. Which one would you like to track?`,
      buttons: buttons,
      showAsButtons: true
    };
  } catch (error) {
    console.error('Error fetching trackable orders:', error);
    return {
      ...aiResponse,
      message: "I'm having trouble accessing your tracking information. A customer executive will reach out to you soon!"
    };
  }
}

/**
 * Handler for specific order tracking (when user clicks track button)
 */
async function handleSpecificOrderTracking(userId, aiResponse) {
  try {
    console.log(`[DEBUG] Tracking specific order ${aiResponse.orderId} for user ${userId}`);
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    // Get the specific order
    const order = await db.collection('orders')
      .findOne({ 
        orderId: aiResponse.orderId,
        customerId: userId
      });

    if (!order) {
      return {
        ...aiResponse,
        message: `I couldn't find order ${aiResponse.orderId}. Please check the order ID or contact customer service.`
      };
    }

    // Check if the order is trackable
    if (!['shipped', 'delivered'].includes(order.status)) {
      return {
        ...aiResponse,
        message: `Order ${order.orderId} is currently ${order.status}. Tracking information will be available once your order is shipped.`
      };
    }

    // Generate detailed tracking info
    return generateTrackingInfo(order, aiResponse);

  } catch (error) {
    console.error('Error in handleSpecificOrderTracking:', error);
    return {
      ...aiResponse,
      message: "I'm having trouble accessing your tracking information. A customer executive will reach out to you soon!"
    };
  }
}

/**
 * Handler for order ID-based status checks
 */
async function handleOrderStatusCheck(userId, aiResponse) {
  try {
    console.log(`[DEBUG] Getting order ${aiResponse.orderId} for user ${userId}`);
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    // Get specific order details
    const order = await db.collection('orders')
      .findOne({ 
        orderId: aiResponse.orderId,
        customerId: userId
      });

    if (!order) {
      return {
        ...aiResponse,
        message: `I couldn't find the order you're looking for. Please check the order details or contact customer service.`
      };
    }

    // Format the order details
    const statusMessage = getStatusMessage(order.status);
    const itemsList = order.items.map(item => `${item.name} (Qty: ${item.quantity})`).join(', ');
    
    let trackingInfo = '';
    if (order.tracking && order.tracking.length > 0) {
      const latestTracking = order.tracking[order.tracking.length - 1];
      trackingInfo = `\n📍 Latest Update: ${latestTracking.status} - ${latestTracking.location || 'Processing'} (${new Date(latestTracking.timestamp).toLocaleDateString()})`;
    } else if (order.currentLocation) {
      trackingInfo = `\n📍 Current Location: ${order.currentLocation}`;
    }

    // Add detailed tracking for shipped/delivered orders
    let trackingDetails = '';
    if (['shipped', 'delivered'].includes(order.status)) {
      const sampleHistory = generateSampleTrackingHistory(order.status, order.orderDate);
      trackingDetails = `\n\n**📋 Tracking History:**\n`;
      sampleHistory.forEach(event => {
        trackingDetails += `• ${event.date} - ${event.location}: ${event.description}\n`;
      });
      
      if (order.trackingNumber) {
        trackingDetails += `\n**📦 Tracking Number**: ${order.trackingNumber}`;
      }
    }

    // Create action buttons based on order status
    const actionButtons = [];
    
    if (['pending', 'confirmed', 'processing'].includes(order.status)) {
      actionButtons.push({
        text: 'Cancel This Order',
        value: `cancel_${order.orderId}`,
        action: 'cancel_order_selected'
      });
    }
    
    if (['shipped', 'delivered'].includes(order.status)) {
      actionButtons.push({
        text: 'View Tracking Details',
        value: `track_${order.orderId}`,
        action: 'track_selected'
      });
    }

    return {
      ...aiResponse,
      message: `📦 **${order.items[0]?.name}** ${statusMessage}
      
**Items:** ${itemsList}
**Total:** $${order.totalAmount}
**Order Date:** ${new Date(order.orderDate).toLocaleDateString()}${trackingInfo}${trackingDetails}

${getStatusActions(order.status)}`,
      buttons: actionButtons.length > 0 ? actionButtons : undefined,
      showAsButtons: actionButtons.length > 0
    };

  } catch (error) {
    console.error('Error in handleOrderStatusCheck:', error);
    return {
      ...aiResponse,
      message: 'I apologize, but I encountered an issue retrieving your order details. A customer executive will reach out to you soon!'
    };
  }
}

/**
 * Handler for product name-based status checks
 */
async function handleProductStatusCheck(userId, aiResponse) {
  try {
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    // Create search terms with synonyms
    const productName = aiResponse.productName.toLowerCase();
    const searchTerms = [productName];
    
    // Add common synonyms for audio products
    if (productName.includes('bluetooth')) {
      searchTerms.push(productName.replace('bluetooth', 'wireless'));
      searchTerms.push('wireless headphones', 'wireless earphones', 'earbuds');
    }
    if (productName.includes('wireless')) {
      searchTerms.push(productName.replace('wireless', 'bluetooth'));
      searchTerms.push('bluetooth headphones', 'bluetooth earphones', 'earbuds');
    }
    if (productName.includes('headphones') || productName.includes('earphones')) {
      searchTerms.push('headphones', 'earphones', 'earbuds', 'headset');
    }
    
    console.log(`[DEBUG] Searching for product with terms: ${searchTerms.join(', ')}`);
    
    // Search for orders with matching product names - try each term until we find matches
    let orders = [];
    for (const searchTerm of searchTerms) {
      console.log(`[DEBUG] Trying search term: ${searchTerm}`);
      const termOrders = await db.collection('orders')
        .find({ 
          customerId: userId,
          "items.name": { $regex: searchTerm, $options: 'i' }
        })
        .sort({ orderDate: -1 })
        .toArray();
      
      if (termOrders.length > 0) {
        orders = termOrders;
        console.log(`[DEBUG] Found ${orders.length} orders with term: ${searchTerm}`);
        break; // Use the first matching term
      }
    }

    if (orders.length === 0) {
      return {
        ...aiResponse,
        message: `I couldn't find any orders for "${aiResponse.productName}" or similar products. You can check all your orders or a customer executive will reach out to you soon!`
      };
    }

    if (orders.length === 1) {
      const order = orders[0];
      return {
        ...aiResponse,
        message: `Your ${order.items[0]?.name} is currently ${order.status}. Order total: $${order.totalAmount}.`
      };
    }

    // Multiple matching orders
    const buttons = orders.map(order => ({
      text: `${order.items[0]?.name} - ${order.status} ($${order.totalAmount})`,
      value: order.orderId,
      action: 'order_selected'
    }));

    return {
      ...aiResponse,
      message: `I found ${orders.length} orders matching "${aiResponse.productName}". Which one would you like to check?`,
      buttons: buttons,
      showAsButtons: true
    };
  } catch (error) {
    console.error('Error searching orders by product:', error);
    return {
      ...aiResponse,
      message: "I'm having trouble searching your orders. A customer executive will reach out to you soon!"
    };
  }
}

/**
 * Generate detailed tracking information
 */
function generateTrackingInfo(order, aiResponse) {
  let trackingMessage = `📦 **${order.items[0]?.name}**\n\n`;
  
  if (order.status === 'delivered') {
    trackingMessage += `✅ **Status**: Delivered\n`;
    trackingMessage += `📍 **Current Location**: ${order.currentLocation || 'Delivered to your address'}\n\n`;
  } else {
    trackingMessage += `🚚 **Status**: ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}\n`;
    trackingMessage += `📍 **Current Location**: ${order.currentLocation || 'In Transit'}\n`;
    trackingMessage += `📅 **Estimated Delivery**: ${order.estimatedDelivery ? new Date(order.estimatedDelivery).toLocaleDateString() : 'TBD'}\n\n`;
  }

  // Generate sample tracking history if not available
  if (!order.trackingHistory || order.trackingHistory.length === 0) {
    const sampleHistory = generateSampleTrackingHistory(order.status, order.orderDate);
    trackingMessage += `**📋 Tracking History:**\n`;
    sampleHistory.forEach(event => {
      trackingMessage += `• ${event.date} - ${event.location}: ${event.description}\n`;
    });
  } else {
    trackingMessage += `**📋 Tracking History:**\n`;
    order.trackingHistory.forEach(event => {
      const date = new Date(event.date).toLocaleDateString();
      trackingMessage += `• ${date} - ${event.location}: ${event.description}\n`;
    });
  }

  if (order.trackingNumber) {
    trackingMessage += `\n**📋 Tracking Number**: ${order.trackingNumber}`;
  }

  return {
    ...aiResponse,
    message: trackingMessage
  };
}

/**
 * Generate sample tracking history based on order status
 */
function generateSampleTrackingHistory(status, orderDate) {
  const history = [];
  const orderDay = new Date(orderDate);
  
  // Order placed
  history.push({
    date: orderDay.toLocaleDateString(),
    location: 'Order Processing Center',
    description: 'Order placed and confirmed'
  });
  
  // Processing
  const processingDay = new Date(orderDay);
  processingDay.setDate(processingDay.getDate() + 1);
  history.push({
    date: processingDay.toLocaleDateString(),
    location: 'Fulfillment Center',
    description: 'Order processed and packaged'
  });
  
  if (['shipped', 'delivered'].includes(status)) {
    // Shipped
    const shippedDay = new Date(orderDay);
    shippedDay.setDate(shippedDay.getDate() + 2);
    history.push({
      date: shippedDay.toLocaleDateString(),
      location: 'Distribution Center',
      description: 'Package shipped'
    });
    
    // In transit
    const transitDay = new Date(orderDay);
    transitDay.setDate(transitDay.getDate() + 3);
    history.push({
      date: transitDay.toLocaleDateString(),
      location: 'Local Facility',
      description: 'Package in transit to destination'
    });
  }
  
  if (status === 'delivered') {
    // Delivered
    const deliveredDay = new Date(orderDay);
    deliveredDay.setDate(deliveredDay.getDate() + 4);
    history.push({
      date: deliveredDay.toLocaleDateString(),
      location: 'Your Address',
      description: 'Package delivered successfully'
    });
  }
  
  return history;
}

/**
 * Get status message for display
 */
function getStatusMessage(status) {
  const statusMessages = {
    'pending': 'is being processed',
    'confirmed': 'has been confirmed',
    'shipped': 'has been shipped',
    'delivered': 'has been delivered',
    'cancelled': 'has been cancelled',
    'refund_pending': 'has a refund pending',
    'refunded': 'has been refunded',
    'processing': 'is currently being processed'
  };
  
  return statusMessages[status] || `is in ${status} status`;
}

/**
 * Get status-specific actions
 */
function getStatusActions(status) {
  const actions = {
    'pending': 'You can still cancel this order if needed.',
    'confirmed': 'Your order is confirmed and will be shipped soon.',
    'shipped': 'Your order is on its way! Track it for updates.',
    'delivered': 'Your order has been delivered. Hope you enjoy it!',
    'cancelled': 'This order has been cancelled.',
    'refund_pending': 'Your refund is being processed.',
    'refunded': 'Your refund has been completed.',
    'processing': 'We\'re preparing your order for shipment.'
  };
  
  return actions[status] || 'Contact customer service for more information.';
}

/**
 * Handler for showing cancellable orders
 */
async function handleCancelOrders(userId, aiResponse) {
  try {
    console.log(`[DEBUG] Getting cancellable orders for user ${userId}`);
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    // Get orders that can be cancelled (pending, confirmed, processing)
    const cancellableStatuses = ['pending', 'confirmed', 'processing'];
    const orders = await db.collection('orders')
      .find({ 
        customerId: userId,
        status: { $in: cancellableStatuses }
      })
      .sort({ orderDate: -1 })
      .toArray();

    if (orders.length === 0) {
      return {
        ...aiResponse,
        message: 'You have no orders that can be cancelled at this time. All your recent orders are either shipped, delivered, or already cancelled.'
      };
    }

    console.log(`[DEBUG] Found ${orders.length} cancellable orders for user ${userId}`);

    // Create buttons for each cancellable order
    const buttons = orders.map(order => {
      const itemsList = order.items.map(item => item.name).join(', ');
      return {
        text: `${itemsList} - $${order.totalAmount}`,
        value: `cancel_${order.orderId}`,
        action: 'cancel_order_selected'
      };
    });

    return {
      ...aiResponse,
      message: 'Here are your orders that can be cancelled. Click on any order to proceed with cancellation:',
      buttons: buttons,
      showAsButtons: true
    };

  } catch (error) {
    console.error('Error in handleCancelOrders:', error);
    return {
      ...aiResponse,
      message: 'I apologize, but I encountered an issue retrieving your cancellable orders. A customer executive will reach out to you soon!'
    };
  }
}

/**
 * Handler for order cancellation requests (specific order)
 */
async function handleOrderCancellation(userId, aiResponse, originalMessage, sessionId) {
  try {
    console.log(`[DEBUG] Processing cancellation request for order ${aiResponse.orderId} by user ${userId}`);
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    // Check if this is a cancellation confirmation from button click
    if (originalMessage.includes('cancel_') && originalMessage.includes(':')) {
      // Extract order ID from button click format: "cancel_ORD-2024-001"
      const cancelMatch = originalMessage.match(/cancel_([^:]+)/);
      if (cancelMatch) {
        const orderId = cancelMatch[1];
        
        // Get the order details
        const order = await db.collection('orders')
          .findOne({ 
            orderId: orderId,
            customerId: userId
          });

        if (!order) {
          return {
            ...aiResponse,
            message: `I couldn't find order ${orderId}. Please check the order ID.`
          };
        }

        // Check if order can be cancelled
        const cancellableStatuses = ['pending', 'confirmed', 'processing'];
        if (!cancellableStatuses.includes(order.status)) {
          return {
            ...aiResponse,
            message: `Order ${orderId} cannot be cancelled as it is currently ${order.status}. Please contact customer service for assistance.`
          };
        }

        // Create confirmation buttons
        const itemsList = order.items.map(item => item.name).join(', ');
        const confirmButtons = [
          {
            text: 'Yes, Cancel Order',
            value: `confirm_cancel_${orderId}`,
            action: 'confirm_cancellation'
          },
          {
            text: 'No, Keep Order',
            value: 'cancel_abort',
            action: 'cancel_abort'
          }
        ];

        return {
          ...aiResponse,
          action: 'confirm_cancellation',
          orderId: orderId,
          message: `⚠️ **Confirm Cancellation**

Are you sure you want to cancel your order for **${itemsList}**?

**Total:** $${order.totalAmount}
**Status:** ${order.status}

This action cannot be undone.`,
          buttons: confirmButtons,
          showAsButtons: true
        };
      }
    }

    // Regular cancellation request with specific order ID
    if (aiResponse.orderId) {
      const order = await db.collection('orders')
        .findOne({ 
          orderId: aiResponse.orderId,
          customerId: userId
        });

      if (!order) {
        return {
          ...aiResponse,
          message: `I couldn't find order ${aiResponse.orderId}. Please check the order ID.`
        };
      }

      // Check if order can be cancelled
      const cancellableStatuses = ['pending', 'confirmed', 'processing'];
      if (!cancellableStatuses.includes(order.status)) {
        return {
          ...aiResponse,
          message: `Order ${aiResponse.orderId} cannot be cancelled as it is currently ${order.status}. Please contact customer service for assistance.`
        };
      }

      // Create confirmation buttons
      const itemsList = order.items.map(item => item.name).join(', ');
      const confirmButtons = [
        {
          text: 'Yes, Cancel Order',
          value: `confirm_cancel_${aiResponse.orderId}`,
          action: 'confirm_cancellation'
        },
        {
          text: 'No, Keep Order', 
          value: 'cancel_abort',
          action: 'cancel_abort'
        }
      ];

      return {
        ...aiResponse,
        action: 'confirm_cancellation',
        message: `⚠️ **Confirm Cancellation**

Are you sure you want to cancel your order for **${itemsList}**?

**Total:** $${order.totalAmount}
**Status:** ${order.status}

This action cannot be undone.`,
        buttons: confirmButtons,
        showAsButtons: true
      };
    }

    return aiResponse;

  } catch (error) {
    console.error('Error in handleOrderCancellation:', error);
    return {
      ...aiResponse,
      message: 'I apologize, but I encountered an issue processing your cancellation request. A customer executive will reach out to you soon!'
    };
  }
}

/**
 * Handler for cancellation confirmations
 */
async function handleConfirmCancellation(userId, aiResponse, originalMessage, sessionId) {
  try {
    console.log(`[DEBUG] Processing cancellation confirmation for user ${userId}: ${originalMessage}`);
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    // Handle confirmation button clicks
    if (originalMessage.includes('confirm_cancel_')) {
      const confirmMatch = originalMessage.match(/confirm_cancel_([A-Z0-9-]+)/);
      if (confirmMatch) {
        const orderId = confirmMatch[1];
        console.log(`[DEBUG] Confirmed cancellation for order ${orderId}`);
        
        // Update order status to cancelled
        const result = await db.collection('orders').updateOne(
          { 
            orderId: orderId,
            customerId: userId
          },
          { 
            $set: { 
              status: 'cancelled',
              cancelledAt: new Date(),
              cancelledBy: userId
            }
          }
        );

        if (result.matchedCount === 0) {
          return {
            ...aiResponse,
            message: `I couldn't find order ${orderId} to cancel. Please contact customer service.`
          };
        }

        if (result.modifiedCount === 0) {
          return {
            ...aiResponse,
            message: `Order ${orderId} could not be cancelled. It may already be cancelled or in a non-cancellable status.`
          };
        }

        // Emit real-time update for cancellation
        const io = require('socket.io')(require('http').createServer());
        if (io && sessionId) {
          io.to(sessionId).emit('order_cancelled', {
            orderId: orderId,
            status: 'cancelled',
            timestamp: new Date().toISOString()
          });
          
          // Also emit a notification event
          io.to(sessionId).emit('notification', {
            type: 'success',
            message: `Order cancelled successfully!\n\nYour order has been cancelled and you will receive a refund within 3-5 business days.`,
            timestamp: new Date().toISOString()
          });
        }

        // Get order details for friendly message
        const order = await db.collection('orders')
          .findOne({ 
            orderId: orderId,
            customerId: userId
          });

        let orderDescription = orderId;
        if (order && order.items && order.items.length > 0) {
          orderDescription = order.items[0].name;
        }

        return {
          ...aiResponse,
          message: `✅ **Order Cancelled Successfully**

Your order for **${orderDescription}** has been cancelled.

You will receive a refund within 3-5 business days. A confirmation email has been sent to your registered email address.

Is there anything else I can help you with?`
        };
      }
    }

    // Handle "No, keep order" button clicks
    if (originalMessage.includes('cancel_abort') || originalMessage.toLowerCase().includes('no') || originalMessage.toLowerCase().includes('keep')) {
      return {
        ...aiResponse,
        message: 'Cancellation aborted. Your order will remain active. Is there anything else I can help you with?'
      };
    }

    return aiResponse;

  } catch (error) {
    console.error('Error in handleConfirmCancellation:', error);
    return {
      ...aiResponse,
      message: 'I apologize, but I encountered an issue processing your cancellation confirmation. A customer executive will reach out to you soon!'
    };
  }
}

/**
 * Handler for cancellation abort (user clicks "No, Keep Order")
 */
async function handleCancelAbort(userId, aiResponse) {
  try {
    return {
      ...aiResponse,
      message: '✅ **Cancellation Cancelled**\n\nYour order will remain active. No changes have been made to your order.\n\nIs there anything else I can help you with?'
    };
  } catch (error) {
    console.error('Error in handleCancelAbort:', error);
    return {
      ...aiResponse,
      message: 'Your order will remain active. Is there anything else I can help you with?'
    };
  }
}

/**
 * Detect product search patterns without using AI
 */
function detectProductSearch(message) {
  const lowerMessage = message.toLowerCase().trim();
  
  // Common product search patterns
  const patterns = [
    /status of (.+)/i,
    /status for (.+)/i,
    /(.+) status/i,
    /check (.+)/i,
    /find (.+)/i,
    /show (.+) order/i,
    /(.+) order status/i
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      let productName = match[1].trim();
      
      // Clean up common words
      productName = productName
        .replace(/\b(my|the|order|orders|status|for)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Only proceed if we have a meaningful product name
      if (productName.length > 2 && !productName.match(/^\d+$/) && !productName.match(/^ord-/i)) {
        return { productName };
      }
    }
  }
  
  return null;
}

/**
 * Detect button action clicks from frontend
 */
function detectButtonAction(message) {
  const trimmedMessage = message.trim();
  
  // Track button clicks: "track_ORD-2024-001"
  const trackMatch = trimmedMessage.match(/^track_([A-Z0-9-]+)$/i);
  if (trackMatch) {
    return {
      action: 'track_selected',
      orderId: trackMatch[1],
      value: trimmedMessage
    };
  }
  
  // Order selection buttons: Direct order ID or "ORD-2024-001: Product Name - $99.99"
  const orderIdMatch = trimmedMessage.match(/^([A-Z0-9-]+)(?::|$)/i);
  if (orderIdMatch && orderIdMatch[1].match(/^ORD-/i)) {
    return {
      action: 'order_selected',
      orderId: orderIdMatch[1],
      value: trimmedMessage
    };
  }
  
  // Cancel button clicks: "cancel_ORD-2024-001"
  const cancelMatch = trimmedMessage.match(/^cancel_([A-Z0-9-]+)$/i);
  if (cancelMatch) {
    return {
      action: 'cancel_order_selected',
      orderId: cancelMatch[1],
      value: trimmedMessage
    };
  }
  
  // Refund button clicks: "refund_ORD-2024-001" or "refund_all"
  const refundMatch = trimmedMessage.match(/^refund_([A-Z0-9-]+|all)$/i);
  if (refundMatch) {
    return {
      action: 'refund_selected',
      orderId: refundMatch[1] !== 'all' ? refundMatch[1] : null,
      value: trimmedMessage
    };
  }
  
  // Confirmation buttons: "confirm_cancel_ORD-2024-001"
  const confirmMatch = trimmedMessage.match(/^confirm_cancel_([A-Z0-9-]+)$/i);
  if (confirmMatch) {
    return {
      action: 'confirm_cancellation',
      orderId: confirmMatch[1],
      value: trimmedMessage
    };
  }
  
  // Cancel abort button: "cancel_abort"
  if (trimmedMessage === 'cancel_abort') {
    return {
      action: 'cancel_abort',
      value: trimmedMessage
    };
  }
  
  return null;
}

/**
 * Detect fallback actions for common queries that shouldn't need clarification
 */
function detectFallbackAction(message) {
  const lowerMessage = message.toLowerCase().trim();
  
  // Track order variations (including typos)
  const trackPatterns = [
    /^track\s?(my)?\s?orders?$/i,
    /^trac\s?orders?$/i,
    /^trak\s?orders?$/i,
    /^track$/i,
    /^where\s+is\s+my\s+order$/i
  ];
  
  if (trackPatterns.some(pattern => pattern.test(message))) {
    return {
      action: 'track_order',
      orderId: null,
      productName: null,
      confidence: 0.95,
      message: "I'll show you the tracking information for your orders."
    };
  }
  
  // Order status variations (including typos)
  const statusPatterns = [
    /^orders?\s?status$/i,
    /^oders?\s?status$/i,
    /^status$/i,
    /^check\s?(my)?\s?orders?$/i,
    /^show\s?(my)?\s?orders?$/i,
    /^list\s?orders?$/i
  ];
  
  if (statusPatterns.some(pattern => pattern.test(message))) {
    return {
      action: 'list_orders',
      orderId: null,
      productName: null,
      confidence: 0.95,
      message: "I'll show you all your orders so you can select the one you're interested in."
    };
  }
  
  return null;
}

/**
 * Process fallback action when AI incorrectly asks for clarification
 */
async function processFallbackAction(userId, fallbackAction) {
  try {
    switch (fallbackAction.action) {
      case 'track_order':
        return await handleTrackOrder(userId, fallbackAction);
      case 'list_orders':
        return await handleListOrders(userId, fallbackAction);
      default:
        return fallbackAction;
    }
  } catch (error) {
    console.error('Error processing fallback action:', error);
    return {
      ...fallbackAction,
      message: "I'm here to help! Let me get your order information for you."
    };
  }
}

module.exports = router;
