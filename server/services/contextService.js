const Conversation = require('../models/Conversation');
const cacheService = require('./cacheService');

/**
 * Service for managing conversation context and history
 */
class ContextService {
  constructor() {
    this.maxContextLength = parseInt(process.env.MAX_CONVERSATION_HISTORY) || 50;
    this.contextCache = new Map();
    this.maxCacheSize = 1000;
  }

  /**
   * Get or create conversation context
   * @param {string} sessionId - Session identifier
   * @param {string} userId - User identifier
   * @returns {Object} - Conversation context
   */
  async getConversationContext(sessionId, userId) {
    try {
      // Check memory cache first
      if (this.contextCache.has(sessionId)) {
        const cached = this.contextCache.get(sessionId);
        if (Date.now() - cached.timestamp < 300000) { // 5 minutes
          return cached.context;
        }
        this.contextCache.delete(sessionId);
      }

      // Check Redis cache
      try {
        const redisContext = await cacheService.getCachedConversationContext(sessionId);
        if (redisContext) {
          this.setCacheContext(sessionId, redisContext);
          return redisContext;
        }
      } catch (redisError) {
        console.warn('Redis cache unavailable:', redisError.message);
      }

      // Get from database
      let conversation = null;
      try {
        conversation = await Conversation.findBySessionId(sessionId);
      } catch (dbError) {
        console.warn('Database query failed:', dbError.message);
        // Continue without database - return minimal context
      }
      
      if (!conversation) {
        // Create minimal context without database
        const minimalContext = {
          sessionId,
          userId,
          conversationHistory: [],
          context: {
            lastOrderInquiry: null,
            userPreferences: {},
            conversationSummary: ''
          }
        };
        
        // Try to create new conversation in database, but don't fail if it doesn't work
        try {
          conversation = new Conversation({
            sessionId,
            userId,
            messages: [],
            context: {
              lastOrderInquiry: null,
              userPreferences: new Map(),
              conversationSummary: ''
            }
          });
          await conversation.save();
          console.log('Created new conversation in database');
        } catch (dbError) {
          console.warn('Could not save conversation to database:', dbError.message);
          // Return minimal context and cache it
          this.setCacheContext(sessionId, minimalContext);
          return minimalContext;
        }
      }

      const context = this.buildContext(conversation);
      
      // Cache the context
      this.setCacheContext(sessionId, context);
      try {
        await cacheService.cacheConversationContext(sessionId, context, 1800); // 30 minutes
      } catch (cacheError) {
        console.warn('Could not cache conversation context:', cacheError.message);
      }

      return context;

    } catch (error) {
      console.error('Error getting conversation context:', error);
      
      // Return minimal context on any error
      return {
        sessionId,
        userId,
        conversationHistory: [],
        context: {
          lastOrderInquiry: null,
          userPreferences: {},
          conversationSummary: ''
        }
      };
    }
  }

  /**
   * Add message to conversation context
   * @param {string} sessionId - Session identifier
   * @param {string} role - Message role (user/assistant/system)
   * @param {string} content - Message content
   * @param {Object} metadata - Additional message metadata
   * @returns {Object} - Updated context
   */
  async addMessage(sessionId, role, content, metadata = {}) {
    try {
      let conversation = null;
      
      try {
        conversation = await Conversation.findBySessionId(sessionId);
      } catch (dbError) {
        console.warn('Database query failed in addMessage:', dbError.message);
      }
      
      if (!conversation) {
        console.warn('Conversation not found, creating minimal context');
        // Update memory cache with new message
        const cachedContext = this.contextCache.get(sessionId);
        if (cachedContext) {
          cachedContext.context.conversationHistory.push({
            role,
            content,
            metadata,
            timestamp: new Date()
          });
          this.setCacheContext(sessionId, cachedContext.context);
        }
        
        // Return minimal context
        return {
          sessionId,
          userId: metadata.userId || 'unknown',
          conversationHistory: [{
            role,
            content,
            metadata,
            timestamp: new Date()
          }],
          context: {
            lastOrderInquiry: null,
            userPreferences: {},
            conversationSummary: ''
          }
        };
      }

      // Add message to conversation
      try {
        await conversation.addMessage(role, content, metadata);
      } catch (dbError) {
        console.warn('Could not save message to database:', dbError.message);
      }

      // Update context cache
      const updatedContext = this.buildContext(conversation);
      this.setCacheContext(sessionId, updatedContext);
      
      // Update Redis cache
      try {
        await cacheService.cacheConversationContext(sessionId, updatedContext, 1800);
      } catch (cacheError) {
        console.warn('Could not update cache:', cacheError.message);
      }

      return updatedContext;

    } catch (error) {
      console.error('Error adding message to context:', error);
      throw error;
    }
  }

  /**
   * Update conversation context with new information
   * @param {string} sessionId - Session identifier
   * @param {Object} contextUpdate - Context updates
   * @returns {Object} - Updated context
   */
  async updateContext(sessionId, contextUpdate) {
    try {
      const conversation = await Conversation.findBySessionId(sessionId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Update conversation context
      await conversation.updateContext(contextUpdate);

      // Rebuild and cache context
      const updatedContext = this.buildContext(conversation);
      this.setCacheContext(sessionId, updatedContext);
      await cacheService.cacheConversationContext(sessionId, updatedContext, 1800);

      return updatedContext;

    } catch (error) {
      console.error('Error updating context:', error);
      throw error;
    }
  }

  /**
   * Get conversation summary for AI context
   * @param {string} sessionId - Session identifier
   * @param {number} messageLimit - Number of recent messages to include
   * @returns {Object} - Conversation summary
   */
  async getConversationSummary(sessionId, messageLimit = 10) {
    try {
      const context = await this.getConversationContext(sessionId);
      const recentMessages = context.conversationHistory.slice(-messageLimit);

      // Extract key information
      const orderIds = new Set();
      const intents = new Set();
      const topics = new Set();

      recentMessages.forEach(message => {
        if (message.metadata) {
          if (message.metadata.orderId) orderIds.add(message.metadata.orderId);
          if (message.metadata.actionType) intents.add(message.metadata.actionType);
        }

        // Extract topics from message content
        const content = message.content.toLowerCase();
        if (content.includes('cancel')) topics.add('cancellation');
        if (content.includes('status') || content.includes('track')) topics.add('tracking');
        if (content.includes('refund')) topics.add('refund');
        if (content.includes('return')) topics.add('return');
      });

      return {
        sessionId,
        messageCount: recentMessages.length,
        orderIds: Array.from(orderIds),
        intents: Array.from(intents),
        topics: Array.from(topics),
        lastActivity: recentMessages.length > 0 ? recentMessages[recentMessages.length - 1].timestamp : null,
        summary: this.generateTextSummary(recentMessages, Array.from(topics))
      };

    } catch (error) {
      console.error('Error getting conversation summary:', error);
      return {
        sessionId,
        messageCount: 0,
        orderIds: [],
        intents: [],
        topics: [],
        lastActivity: null,
        summary: 'No conversation history available'
      };
    }
  }

  /**
   * Clean up old conversation contexts
   * @param {number} olderThanHours - Remove contexts older than this many hours
   * @returns {number} - Number of contexts cleaned up
   */
  async cleanupOldContexts(olderThanHours = 24) {
    try {
      // Clean up database
      const result = await Conversation.cleanupExpired();
      
      // Clean up memory cache
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
      let memoryCleanedCount = 0;
      
      for (const [sessionId, cached] of this.contextCache.entries()) {
        if (cached.timestamp < cutoffTime) {
          this.contextCache.delete(sessionId);
          memoryCleanedCount++;
        }
      }

      // Clean up Redis cache
      await cacheService.clearCache('conv:*');

      console.log(`Cleaned up ${result.deletedCount} database conversations and ${memoryCleanedCount} memory contexts`);
      
      return result.deletedCount + memoryCleanedCount;

    } catch (error) {
      console.error('Error cleaning up contexts:', error);
      return 0;
    }
  }

  /**
   * Get user's conversation statistics
   * @param {string} userId - User identifier
   * @returns {Object} - User conversation stats
   */
  async getUserStats(userId) {
    try {
      const conversations = await Conversation.findActiveByUser(userId);
      
      const stats = {
        totalConversations: conversations.length,
        totalMessages: 0,
        orderInquiries: 0,
        cancellationRequests: 0,
        avgMessagesPerConversation: 0,
        lastActivity: null
      };

      conversations.forEach(conv => {
        stats.totalMessages += conv.messages.length;
        if (conv.updatedAt > stats.lastActivity) {
          stats.lastActivity = conv.updatedAt;
        }

        conv.messages.forEach(msg => {
          if (msg.metadata?.actionType === 'order_cancellation') {
            stats.cancellationRequests++;
          }
          if (msg.metadata?.orderId) {
            stats.orderInquiries++;
          }
        });
      });

      if (stats.totalConversations > 0) {
        stats.avgMessagesPerConversation = Math.round(stats.totalMessages / stats.totalConversations);
      }

      return stats;

    } catch (error) {
      console.error('Error getting user stats:', error);
      return {
        totalConversations: 0,
        totalMessages: 0,
        orderInquiries: 0,
        cancellationRequests: 0,
        avgMessagesPerConversation: 0,
        lastActivity: null
      };
    }
  }

  /**
   * Build context object from conversation model
   * @param {Object} conversation - Conversation model instance
   * @returns {Object} - Context object
   */
  buildContext(conversation) {
    return {
      sessionId: conversation.sessionId,
      userId: conversation.userId,
      conversationHistory: conversation.messages.slice(-this.maxContextLength),
      context: {
        lastOrderInquiry: conversation.context?.lastOrderInquiry || null,
        userPreferences: conversation.context?.userPreferences || {},
        conversationSummary: conversation.context?.conversationSummary || ''
      },
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    };
  }

  /**
   * Set context in memory cache with size limit
   * @param {string} sessionId - Session identifier
   * @param {Object} context - Context object
   */
  setCacheContext(sessionId, context) {
    // Remove oldest entries if cache is full
    if (this.contextCache.size >= this.maxCacheSize) {
      const oldestKey = this.contextCache.keys().next().value;
      this.contextCache.delete(oldestKey);
    }

    this.contextCache.set(sessionId, {
      context,
      timestamp: Date.now()
    });
  }

  /**
   * Generate human-readable conversation summary
   * @param {Array} messages - Recent messages
   * @param {Array} topics - Identified topics
   * @returns {string} - Text summary
   */
  generateTextSummary(messages, topics) {
    if (messages.length === 0) return 'No recent activity';

    const userMessages = messages.filter(msg => msg.role === 'user').length;
    const assistantMessages = messages.filter(msg => msg.role === 'assistant').length;

    let summary = `${userMessages} user messages, ${assistantMessages} assistant responses`;
    
    if (topics.length > 0) {
      summary += `. Topics discussed: ${topics.join(', ')}`;
    }

    // Add context about recent activity
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      const timeSince = Date.now() - new Date(lastMessage.timestamp).getTime();
      const minutesAgo = Math.floor(timeSince / 60000);
      
      if (minutesAgo < 5) {
        summary += '. Active conversation';
      } else if (minutesAgo < 60) {
        summary += `. Last activity ${minutesAgo} minutes ago`;
      }
    }

    return summary;
  }

  /**
   * Export conversation for analysis or debugging
   * @param {string} sessionId - Session identifier
   * @returns {Object} - Complete conversation export
   */
  async exportConversation(sessionId) {
    try {
      const conversation = await Conversation.findBySessionId(sessionId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      return {
        sessionId: conversation.sessionId,
        userId: conversation.userId,
        messages: conversation.messages,
        context: conversation.context,
        status: conversation.status,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        exportedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error exporting conversation:', error);
      throw error;
    }
  }
}

module.exports = new ContextService();
