const geminiClient = require('../config/gemini');
const promptBuilder = require('../utils/geminiPromptBuilder');
const cacheService = require('./cacheService');
const sanitizeInput = require('../utils/sanitizeInput');

/**
 * Service for AI interactions and response parsing
 */
class AIService {
  constructor() {
    this.responseCache = new Map(); // In-memory cache for frequent responses
    this.maxCacheSize = 100;
    
    // Response parsing patterns
    this.jsonPatterns = [
      /\{[\s\S]*\}/,  // Standard JSON
      /```json\s*(\{[\s\S]*?\})\s*```/i,  // JSON in code blocks
      /```\s*(\{[\s\S]*?\})\s*```/i   // JSON in generic code blocks
    ];
  }

  /**
   * Process user message and generate AI response
   * @param {string} userMessage - User's message
   * @param {Object} context - Conversation context
   * @param {Object} options - Processing options
   * @returns {Object} - Processed AI response
   */
  async processMessage(userMessage, context = {}, options = {}) {
    const startTime = Date.now();

    try {
      // Input validation and sanitization
      const validationResult = sanitizeInput.validateOrderInput(userMessage);
      
      if (!validationResult.isValid) {
        throw new Error(`Invalid input: ${validationResult.validationError}`);
      }

      if (validationResult.riskScore > 70) {
        throw new Error('Input rejected due to security concerns');
      }

      // Check cache first
      const cacheHash = cacheService.generateAIResponseHash(
        validationResult.sanitized, 
        context.conversationHistory || [],
        { userId: context.userId }
      );

      const cachedResponse = await cacheService.getCachedAIResponse(cacheHash);
      if (cachedResponse && !options.bypassCache) {
        return {
          ...cachedResponse,
          cached: true,
          processingTime: Date.now() - startTime
        };
      }

      // Build AI prompt
      const prompt = promptBuilder.buildOrderPrompt(
        validationResult.sanitized,
        context.conversationHistory || [],
        options
      );

      // Generate AI response
      const rawResponse = await geminiClient.generateContent(prompt);
      
      // Parse and validate response
      const parsedResponse = this.parseAIResponse(rawResponse);
      
      // Validate the parsed response
      const validationResult2 = await this.validateAIResponse(
        validationResult.sanitized,
        parsedResponse,
        context
      );

      if (!validationResult2.isValid) {
        throw new Error(`AI response validation failed: ${validationResult2.reason}`);
      }

      // Enhance response with metadata
      const enhancedResponse = {
        ...parsedResponse,
        metadata: {
          processingTime: Date.now() - startTime,
          cached: false,
          confidence: parsedResponse.confidence || 0.5,
          riskScore: validationResult.riskScore,
          validationPassed: true
        }
      };

      // Cache the response
      await cacheService.cacheAIResponse(cacheHash, enhancedResponse, 3600);

      return enhancedResponse;

    } catch (error) {
      console.error('AI Service Error:', error);
      
      // Return safe error response
      return {
        action: 'error',
        orderId: null,
        confidence: 0.0,
        message: 'I apologize, but I encountered an issue processing your request. Please try again or contact support.',
        requiresConfirmation: false,
        metadata: {
          error: error.message,
          processingTime: Date.now() - startTime,
          cached: false
        }
      };
    }
  }

  /**
   * Parse AI response from raw text
   * @param {string} rawResponse - Raw AI response
   * @returns {Object} - Parsed response object
   */
  parseAIResponse(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') {
      throw new Error('Invalid AI response format');
    }

    // Try to extract JSON from response
    let jsonStr = rawResponse.trim();
    let parsedJson = null;

    // Try different JSON extraction patterns
    for (const pattern of this.jsonPatterns) {
      const match = rawResponse.match(pattern);
      if (match) {
        jsonStr = match[1] || match[0];
        break;
      }
    }

    try {
      parsedJson = JSON.parse(jsonStr);
    } catch (error) {
      throw new Error(`Failed to parse AI response as JSON: ${error.message}`);
    }

    // Validate required fields
    const requiredFields = ['action', 'message'];
    const missingFields = requiredFields.filter(field => !parsedJson[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields in AI response: ${missingFields.join(', ')}`);
    }

    // Validate action values
    const validActions = [
      'order_cancellation',
      'status_check',
      'list_orders',
      'refund_status', 
      'track_order',
      'track_specific_order',
      'cancel_orders',
      'confirm_cancellation',
      'cancel_abort',
      'general_inquiry',
      'clarification_needed',
      'error'
    ];

    if (!validActions.includes(parsedJson.action)) {
      throw new Error(`Invalid action in AI response: ${parsedJson.action}`);
    }

    // Ensure confidence is a valid number
    if (parsedJson.confidence !== undefined) {
      parsedJson.confidence = Math.max(0, Math.min(1, parseFloat(parsedJson.confidence) || 0));
    }

    // Set defaults for optional fields
    return {
      action: parsedJson.action,
      orderId: parsedJson.orderId || null,
      productName: parsedJson.productName || null,
      confidence: parsedJson.confidence || 0.5,
      message: parsedJson.message,
      requiresConfirmation: parsedJson.requiresConfirmation !== false, // Default to true
      metadata: parsedJson.metadata || {}
    };
  }

  /**
   * Validate AI response against business rules
   * @param {string} originalMessage - Original user message
   * @param {Object} aiResponse - Parsed AI response
   * @param {Object} context - Request context
   * @returns {Object} - Validation result
   */
  async validateAIResponse(originalMessage, aiResponse, context) {
    const issues = [];

    // Check if order ID is provided when action requires it
    if (['order_cancellation'].includes(aiResponse.action)) {
      if (!aiResponse.orderId) {
        issues.push('Order ID required for this action but not provided');
      }
    }
    
    // For status_check, require either orderId OR productName
    if (aiResponse.action === 'status_check') {
      if (!aiResponse.orderId && !aiResponse.productName) {
        issues.push('Status check requires either Order ID or Product Name');
      }
    }

    // Validate order ID format if provided
    if (aiResponse.orderId) {
      const orderIdRegex = /^[A-Z0-9\-]{3,20}$/i; // Allow dashes in order IDs
      if (!orderIdRegex.test(aiResponse.orderId)) {
        issues.push('Order ID format is invalid');
      }
    }

    // Check confidence levels
    if (aiResponse.confidence < 0.3 && aiResponse.action === 'order_cancellation') {
      issues.push('Confidence too low for order cancellation action');
    }

    // Validate message content
    if (!aiResponse.message || aiResponse.message.length < 10) {
      issues.push('Response message is too short or missing');
    }

    // Check for potential hallucination
    if (aiResponse.orderId && originalMessage) {
      const extractedOrderIds = sanitizeInput.extractOrderIds(originalMessage);
      if (extractedOrderIds.orderIds.length > 0 && 
          !extractedOrderIds.orderIds.includes(aiResponse.orderId.toUpperCase())) {
        issues.push('AI response contains order ID not found in user message');
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      reason: issues.length > 0 ? issues.join('; ') : null
    };
  }

  /**
   * Generate streaming response for real-time chat
   * @param {string} userMessage - User message
   * @param {Object} context - Conversation context
   * @returns {AsyncIterable} - Streaming response
   */
  async *generateStreamingResponse(userMessage, context = {}) {
    try {
      // Validate input
      const validationResult = sanitizeInput.validateOrderInput(userMessage);
      if (!validationResult.isValid || validationResult.riskScore > 70) {
        yield { error: 'Invalid or unsafe input' };
        return;
      }

      // Build streaming prompt
      const prompt = promptBuilder.buildStreamingPrompt(
        validationResult.sanitized,
        JSON.stringify(context.conversationHistory?.slice(-3) || [])
      );

      // Get streaming response from Gemini
      const stream = await geminiClient.generateStreamContent(prompt);
      
      let buffer = '';
      
      for await (const chunk of stream) {
        const chunkText = chunk.text();
        buffer += chunkText;
        
        // Yield incremental updates
        yield {
          content: chunkText,
          buffer: buffer,
          complete: false
        };
      }

      // Final response
      yield {
        content: '',
        buffer: buffer,
        complete: true
      };

    } catch (error) {
      console.error('Streaming error:', error);
      yield { error: error.message };
    }
  }

  /**
   * Analyze conversation sentiment and extract insights
   * @param {Array} conversationHistory - Message history
   * @returns {Object} - Conversation analysis
   */
  async analyzeConversation(conversationHistory) {
    if (!conversationHistory || conversationHistory.length === 0) {
      return { sentiment: 'neutral', insights: [], confidence: 0 };
    }

    try {
      const recentMessages = conversationHistory.slice(-10);
      const userMessages = recentMessages
        .filter(msg => msg.role === 'user')
        .map(msg => msg.content)
        .join(' ');

      // Basic sentiment analysis keywords
      const positiveKeywords = ['thank', 'great', 'perfect', 'good', 'satisfied', 'happy'];
      const negativeKeywords = ['angry', 'frustrated', 'terrible', 'awful', 'hate', 'cancel', 'refund'];
      const urgentKeywords = ['urgent', 'immediately', 'asap', 'quickly', 'emergency'];

      const lowerText = userMessages.toLowerCase();
      
      const positiveCount = positiveKeywords.filter(word => lowerText.includes(word)).length;
      const negativeCount = negativeKeywords.filter(word => lowerText.includes(word)).length;
      const urgentCount = urgentKeywords.filter(word => lowerText.includes(word)).length;

      let sentiment = 'neutral';
      if (positiveCount > negativeCount) sentiment = 'positive';
      else if (negativeCount > positiveCount) sentiment = 'negative';

      const insights = [];
      if (urgentCount > 0) insights.push('Customer indicates urgency');
      if (negativeCount > 2) insights.push('Customer appears frustrated');
      if (lowerText.includes('cancel')) insights.push('Cancellation intent detected');

      return {
        sentiment,
        insights,
        confidence: Math.min((positiveCount + negativeCount) / 10, 1),
        metrics: {
          positiveCount,
          negativeCount,
          urgentCount,
          totalMessages: recentMessages.length
        }
      };

    } catch (error) {
      console.error('Conversation analysis error:', error);
      return { sentiment: 'neutral', insights: [], confidence: 0 };
    }
  }

  /**
   * Get service health and statistics
   * @returns {Object} - Service metrics
   */
  async getServiceStats() {
    const cacheStats = await cacheService.getStats();
    
    return {
      cacheStats,
      memoryCache: {
        size: this.responseCache.size,
        maxSize: this.maxCacheSize
      },
      geminiHealth: await geminiClient.testConnection()
    };
  }
}

module.exports = new AIService();
