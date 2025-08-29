const OrderCache = require('../models/OrderCache');
const AuditLog = require('../models/AuditLog');

/**
 * Critical service for validating AI actions before execution
 */
class ActionValidator {
  constructor() {
    // Define validation rules for different actions
    this.validationRules = {
      order_cancellation: [
        'orderExists',
        'orderBelongsToUser',
        'orderIsCancellable',
        'noRecentCancellations',
        'validOrderStatus'
      ],
      status_check: [
        'orderExists',
        'orderBelongsToUser'
      ],
      general_inquiry: [
        'rateLimitCheck'
      ]
    };

    // Non-cancellable order statuses
    this.nonCancellableStatuses = [
      'shipped',
      'delivered', 
      'cancelled',
      'refunded',
      'returned'
    ];

    // Maximum cancellation attempts per user per day
    this.maxCancellationAttempts = 5;
  }

  /**
   * Validate an AI action before execution
   * @param {Object} aiResponse - The AI response to validate
   * @param {Object} context - Request context (userId, sessionId, etc.)
   * @param {Object} options - Validation options
   * @returns {Object} - Validation result with details
   */
  async validateAction(aiResponse, context, options = {}) {
    const startTime = Date.now();
    
    try {
      const validationResult = {
        isValid: true,
        action: aiResponse.action,
        orderId: aiResponse.orderId,
        userId: context.userId,
        sessionId: context.sessionId,
        checks: [],
        reasons: [],
        recommendations: [],
        riskScore: 0,
        metadata: {
          validationTime: 0,
          rulesApplied: []
        }
      };

      // Get validation rules for this action
      const rules = this.validationRules[aiResponse.action] || [];
      validationResult.metadata.rulesApplied = rules;

      // Execute each validation rule
      for (const rule of rules) {
        const checkResult = await this.executeValidationRule(
          rule, 
          aiResponse, 
          context, 
          options
        );

        validationResult.checks.push(checkResult);

        if (!checkResult.passed) {
          validationResult.isValid = false;
          validationResult.reasons.push(checkResult.reason);
          validationResult.riskScore += checkResult.riskWeight || 25;
        }

        if (checkResult.recommendation) {
          validationResult.recommendations.push(checkResult.recommendation);
        }
      }

      // Calculate final risk score
      validationResult.riskScore = Math.min(validationResult.riskScore, 100);
      
      // Additional risk assessment
      await this.assessAdditionalRisks(validationResult, aiResponse, context);

      validationResult.metadata.validationTime = Date.now() - startTime;

      // Log validation result
      await this.logValidationResult(validationResult, aiResponse, context);

      return validationResult;

    } catch (error) {
      console.error('Action validation error:', error);
      
      // Return failed validation on error
      return {
        isValid: false,
        action: aiResponse.action,
        orderId: aiResponse.orderId,
        userId: context.userId,
        sessionId: context.sessionId,
        checks: [],
        reasons: [`Validation error: ${error.message}`],
        recommendations: ['Contact system administrator'],
        riskScore: 100,
        metadata: {
          validationTime: Date.now() - startTime,
          rulesApplied: [],
          error: error.message
        }
      };
    }
  }

  /**
   * Execute a specific validation rule
   * @param {string} ruleName - Name of the validation rule
   * @param {Object} aiResponse - AI response being validated
   * @param {Object} context - Request context
   * @param {Object} options - Validation options
   * @returns {Object} - Rule execution result
   */
  async executeValidationRule(ruleName, aiResponse, context, options) {
    const checkResult = {
      name: ruleName,
      passed: false,
      reason: '',
      details: {},
      riskWeight: 25,
      recommendation: null
    };

    try {
      switch (ruleName) {
        case 'orderExists':
          return await this.checkOrderExists(aiResponse.orderId, checkResult);
        
        case 'orderBelongsToUser':
          return await this.checkOrderBelongsToUser(aiResponse.orderId, context.userId, checkResult);
        
        case 'orderIsCancellable':
          return await this.checkOrderIsCancellable(aiResponse.orderId, checkResult);
        
        case 'noRecentCancellations':
          return await this.checkRecentCancellations(context.userId, checkResult);
        
        case 'validOrderStatus':
          return await this.checkOrderStatus(aiResponse.orderId, checkResult);
        
        case 'rateLimitCheck':
          return await this.checkRateLimit(context.userId, checkResult);
        
        default:
          checkResult.reason = `Unknown validation rule: ${ruleName}`;
          return checkResult;
      }
    } catch (error) {
      checkResult.reason = `Rule execution error: ${error.message}`;
      checkResult.riskWeight = 50;
      return checkResult;
    }
  }

  /**
   * Check if order exists in the system
   */
  async checkOrderExists(orderId, checkResult) {
    console.log('[DEBUG] ActionValidator.checkOrderExists - orderId:', orderId);
    
    if (!orderId) {
      checkResult.reason = 'Order ID is required';
      console.log('[DEBUG] No orderId provided');
      return checkResult;
    }

    // First check OrderCache
    let order = await OrderCache.findByOrderId(orderId);
    console.log('[DEBUG] OrderCache result:', !!order);
    
    // If not in OrderCache, check direct orders collection
    if (!order) {
      console.log('[DEBUG] Not in cache, checking direct orders collection...');
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      
      const directOrder = await db.collection('orders').findOne({ orderId: orderId });
      console.log('[DEBUG] Direct orders query result:', !!directOrder);
      
      if (directOrder) {
        console.log('[DEBUG] Found in direct orders:', directOrder.orderId, 'status:', directOrder.status);
        // Convert to expected format
        order = {
          orderId: directOrder.orderId,
          status: directOrder.status,
          userId: directOrder.customerId || directOrder.userId,
          customerId: directOrder.customerId,
          orderData: directOrder
        };
        console.log('[DEBUG] Converted order object created');
      } else {
        console.log('[DEBUG] Order not found in direct orders collection');
      }
    }
    
    if (order) {
      checkResult.passed = true;
      checkResult.details.orderFound = true;
      checkResult.details.orderStatus = order.status;
      checkResult.details.source = 'database';
      console.log('[DEBUG] Order validation PASSED - status:', order.status);
    } else {
      checkResult.reason = `Order ${orderId} not found`;
      checkResult.recommendation = 'Verify order ID and try again';
      checkResult.riskWeight = 50; // Higher risk for non-existent orders
      console.log('[DEBUG] Order validation FAILED - not found');
    }

    return checkResult;
  }

  /**
   * Check if order belongs to the requesting user
   */
  async checkOrderBelongsToUser(orderId, userId, checkResult) {
    if (!orderId || !userId) {
      checkResult.reason = 'Order ID and user ID are required';
      return checkResult;
    }

    // First check OrderCache
    let order = await OrderCache.findByOrderId(orderId);
    
    // If not in OrderCache, check direct orders collection
    if (!order) {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      
      const directOrder = await db.collection('orders').findOne({ orderId: orderId });
      
      if (directOrder) {
        order = {
          orderId: directOrder.orderId,
          status: directOrder.status,
          userId: directOrder.customerId || directOrder.userId,
          customerId: directOrder.customerId
        };
      }
    }
    
    if (!order) {
      checkResult.reason = `Order ${orderId} not found`;
      checkResult.riskWeight = 75; // Very high risk
      return checkResult;
    }

    const orderBelongsToUser = order.userId === userId || 
                               order.customerId === userId ||
                               process.env.NODE_ENV === 'development';

    if (orderBelongsToUser) {
      checkResult.passed = true;
      checkResult.details.ownershipVerified = true;
    } else {
      checkResult.reason = `Order ${orderId} does not belong to user ${userId}`;
      checkResult.recommendation = 'Verify user identity and order ownership';
      checkResult.riskWeight = 100; // Maximum risk for unauthorized access
    }

    return checkResult;
  }

  /**
   * Check if order can be cancelled based on business rules
   */
  async checkOrderIsCancellable(orderId, checkResult) {
    // First check OrderCache
    let order = await OrderCache.findByOrderId(orderId);
    
    // If not in OrderCache, check direct orders collection
    if (!order) {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      
      const directOrder = await db.collection('orders').findOne({ orderId: orderId });
      
      if (directOrder) {
        order = {
          orderId: directOrder.orderId,
          status: directOrder.status,
          canCancel: () => ['pending', 'confirmed'].includes(directOrder.status)
        };
      }
    }
    
    if (!order) {
      checkResult.reason = `Order ${orderId} not found`;
      return checkResult;
    }

    const canCancel = typeof order.canCancel === 'function' 
      ? order.canCancel() 
      : ['pending', 'confirmed'].includes(order.status);
    
    if (canCancel) {
      checkResult.passed = true;
      checkResult.details.cancellable = true;
      checkResult.details.currentStatus = order.status;
    } else {
      checkResult.reason = `Order ${orderId} cannot be cancelled (status: ${order.status})`;
      checkResult.recommendation = 'Contact customer service for assistance';
      checkResult.riskWeight = 15; // Lower risk, just business rule
    }

    return checkResult;
  }

  /**
   * Check for recent cancellation attempts to prevent abuse
   */
  async checkRecentCancellations(userId, checkResult) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const recentCancellations = await AuditLog.countDocuments({
      userId: userId,
      action: 'order_cancellation_request',
      timestamp: { $gte: twentyFourHoursAgo }
    });

    if (recentCancellations < this.maxCancellationAttempts) {
      checkResult.passed = true;
      checkResult.details.recentCancellations = recentCancellations;
      checkResult.details.remainingAttempts = this.maxCancellationAttempts - recentCancellations;
    } else {
      checkResult.reason = `Too many cancellation attempts (${recentCancellations}/${this.maxCancellationAttempts})`;
      checkResult.recommendation = 'Wait 24 hours before attempting another cancellation';
      checkResult.riskWeight = 40;
    }

    return checkResult;
  }

  /**
   * Detailed order status validation
   */
  async checkOrderStatus(orderId, checkResult) {
    console.log(`[DEBUG] ActionValidator.checkOrderStatus - orderId: ${orderId}`);
    
    // First check OrderCache
    let order = await OrderCache.findByOrderId(orderId);
    console.log(`[DEBUG] OrderCache result:`, !!order);
    
    // If not in cache, check direct orders collection
    if (!order) {
      console.log(`[DEBUG] Not in cache, checking direct orders collection...`);
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      
      const directOrder = await db.collection('orders').findOne({ orderId });
      console.log(`[DEBUG] Direct orders query result:`, !!directOrder);
      
      if (directOrder) {
        console.log(`[DEBUG] Found in direct orders: ${directOrder.orderId} status: ${directOrder.status}`);
        // Convert to expected format
        order = {
          orderId: directOrder.orderId,
          status: directOrder.status,
          customerId: directOrder.customerId
        };
        console.log(`[DEBUG] Converted order object created`);
      }
    }
    
    if (!order) {
      checkResult.reason = `Order ${orderId} not found`;
      return checkResult;
    }

    const status = order.status.toLowerCase();
    console.log(`[DEBUG] Order status check - status: ${status}`);
    
    if (!this.nonCancellableStatuses.includes(status)) {
      checkResult.passed = true;
      checkResult.details.validStatus = true;
      checkResult.details.currentStatus = status;
      console.log(`[DEBUG] Status validation PASSED - status: ${status}`);
    } else {
      checkResult.reason = `Order status '${status}' does not allow cancellation`;
      checkResult.recommendation = status === 'shipped' 
        ? 'Contact customer service to arrange return'
        : 'This order has already been processed';
      checkResult.riskWeight = 10; // Low risk, just informational
      console.log(`[DEBUG] Status validation FAILED - status: ${status} not cancellable`);
    }

    return checkResult;
  }

  /**
   * Check user rate limits
   */
  async checkRateLimit(userId, checkResult) {
    // This would integrate with your rate limiting service
    // For now, basic implementation
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const recentRequests = await AuditLog.countDocuments({
      userId: userId,
      timestamp: { $gte: fiveMinutesAgo }
    });

    const rateLimit = 50; // 50 requests per 5 minutes
    
    if (recentRequests < rateLimit) {
      checkResult.passed = true;
      checkResult.details.requestCount = recentRequests;
      checkResult.details.remainingRequests = rateLimit - recentRequests;
    } else {
      checkResult.reason = 'Rate limit exceeded';
      checkResult.recommendation = 'Please slow down your requests';
      checkResult.riskWeight = 30;
    }

    return checkResult;
  }

  /**
   * Assess additional risks based on patterns and context
   */
  async assessAdditionalRisks(validationResult, aiResponse, context) {
    // Check for suspicious patterns
    if (aiResponse.confidence < 0.5 && aiResponse.action === 'order_cancellation') {
      validationResult.riskScore += 20;
      validationResult.recommendations.push('Low AI confidence - manual review recommended');
    }

    // Check for rapid-fire requests
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentActivity = await AuditLog.countDocuments({
      userId: context.userId,
      sessionId: context.sessionId,
      timestamp: { $gte: oneMinuteAgo }
    });

    if (recentActivity > 10) {
      validationResult.riskScore += 25;
      validationResult.recommendations.push('High activity detected - potential automation');
    }

    // Check for order ID patterns that might indicate testing/probing
    if (aiResponse.orderId) {
      const suspiciousPatterns = [
        /^(test|demo|sample)/i,
        /^(123|000|999)/,
        /^[a-z]+$/i // All letters, no numbers
      ];

      if (suspiciousPatterns.some(pattern => pattern.test(aiResponse.orderId))) {
        validationResult.riskScore += 15;
        validationResult.recommendations.push('Suspicious order ID pattern detected');
      }
    }
  }

  /**
   * Log validation results for auditing
   */
  async logValidationResult(validationResult, aiResponse, context) {
    try {
      const auditData = {
        sessionId: context.sessionId,
        userId: context.userId,
        action: 'validation_check',
        orderId: aiResponse.orderId,
        details: {
          aiResponse: {
            action: aiResponse.action,
            confidence: aiResponse.confidence,
            orderId: aiResponse.orderId
          },
          validationResult: {
            isValid: validationResult.isValid,
            riskScore: validationResult.riskScore,
            checksCount: validationResult.checks.length,
            failedChecks: validationResult.checks.filter(c => !c.passed).length,
            recommendations: validationResult.recommendations.length
          },
          performanceMetrics: {
            validationTime: validationResult.metadata.validationTime
          },
          metadata: {
            rulesApplied: validationResult.metadata.rulesApplied,
            timestamp: new Date().toISOString()
          }
        },
        result: validationResult.isValid ? 'success' : 'failure',
        severity: validationResult.riskScore > 75 ? 'critical' : 
                 validationResult.riskScore > 50 ? 'error' : 
                 validationResult.riskScore > 25 ? 'warning' : 'info'
      };

      await AuditLog.logAction(auditData);

    } catch (error) {
      console.error('Error logging validation result:', error);
    }
  }

  /**
   * Get validation statistics
   */
  async getValidationStats(timeWindow = 24) {
    try {
      const since = new Date(Date.now() - timeWindow * 60 * 60 * 1000);
      
      const stats = await AuditLog.aggregate([
        {
          $match: {
            action: 'validation_check',
            timestamp: { $gte: since }
          }
        },
        {
          $group: {
            _id: '$result',
            count: { $sum: 1 },
            avgRiskScore: { $avg: '$details.validationResult.riskScore' },
            avgValidationTime: { $avg: '$details.performanceMetrics.validationTime' }
          }
        }
      ]);

      const summary = {
        timeWindow: `${timeWindow} hours`,
        totalValidations: 0,
        successRate: 0,
        averageRiskScore: 0,
        averageValidationTime: 0
      };

      stats.forEach(stat => {
        summary.totalValidations += stat.count;
        if (stat._id === 'success') {
          summary.successRate = stat.count;
        }
        summary.averageRiskScore += (stat.avgRiskScore || 0) * stat.count;
        summary.averageValidationTime += (stat.avgValidationTime || 0) * stat.count;
      });

      if (summary.totalValidations > 0) {
        summary.successRate = ((summary.successRate / summary.totalValidations) * 100).toFixed(2);
        summary.averageRiskScore = (summary.averageRiskScore / summary.totalValidations).toFixed(2);
        summary.averageValidationTime = Math.round(summary.averageValidationTime / summary.totalValidations);
      }

      return summary;

    } catch (error) {
      console.error('Error getting validation stats:', error);
      return {
        error: error.message,
        timeWindow: `${timeWindow} hours`,
        totalValidations: 0
      };
    }
  }
}

module.exports = new ActionValidator();
