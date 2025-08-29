const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'order_cancellation_request',
      'order_cancellation_approved',
      'order_cancellation_denied',
      'order_status_check',
      'ai_response_generated',
      'cache_hit',
      'cache_miss',
      'validation_failed',
      'validation_check',
      'security_violation'
    ]
  },
  orderId: {
    type: String,
    index: true
  },
  details: {
    userMessage: String,
    aiResponse: String,
    aiConfidence: Number,
    validationResult: {
      passed: Boolean,
      reason: String,
      checks: [{
        name: String,
        passed: Boolean,
        details: String
      }]
    },
    performanceMetrics: {
      aiResponseTime: Number, // milliseconds
      cacheResponseTime: Number,
      totalResponseTime: Number
    },
    metadata: {
      userAgent: String,
      ipAddress: String,
      cached: Boolean,
      source: String // 'web', 'mobile', 'api'
    }
  },
  result: {
    type: String,
    enum: ['success', 'failure', 'partial', 'blocked'],
    required: true
  },
  errorMessage: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    default: 'info'
  }
});

// Instance methods
auditLogSchema.methods.markAsProcessed = function() {
  this.processed = true;
  return this.save();
};

// Static methods
auditLogSchema.statics.logAction = async function(auditData) {
  try {
    // Ensure we have the required fields from auditData
    const { sessionId, userId, action, orderId, details, result } = auditData;
    
    if (!userId) {
      console.error('AuditLog.logAction: userId is required');
      return null;
    }
    
    if (!action) {
      console.error('AuditLog.logAction: action is required');
      return null;
    }

    // Ensure aiResponse is properly stringified if it's an object
    let processedDetails = { ...details };
    if (processedDetails && processedDetails.aiResponse && typeof processedDetails.aiResponse === 'object') {
      processedDetails.aiResponse = JSON.stringify(processedDetails.aiResponse);
    }
    
    const auditLog = new this({
      sessionId: sessionId || 'unknown',
      userId,
      action,
      orderId: orderId || null,
      details: processedDetails,
      result: result || 'success'
    });
    
    return await auditLog.save();
  } catch (error) {
    console.error('Audit log error:', error);
    return null;
  }
};

auditLogSchema.statics.findByUser = function(userId, limit = 100) {
  return this.find({ userId })
    .sort({ timestamp: -1 })
    .limit(limit);
};

auditLogSchema.statics.findBySession = function(sessionId) {
  return this.find({ sessionId })
    .sort({ timestamp: -1 });
};

auditLogSchema.statics.findByOrder = function(orderId) {
  return this.find({ orderId })
    .sort({ timestamp: -1 });
};

auditLogSchema.statics.getSecurityEvents = function(timeWindow = 24) {
  const since = new Date(Date.now() - timeWindow * 60 * 60 * 1000);
  return this.find({
    timestamp: { $gte: since },
    $or: [
      { action: 'security_violation' },
      { action: 'validation_failed' },
      { severity: 'critical' }
    ]
  }).sort({ timestamp: -1 });
};

auditLogSchema.statics.getPerformanceMetrics = function(timeWindow = 24) {
  const since = new Date(Date.now() - timeWindow * 60 * 60 * 1000);
  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: since },
        'details.performanceMetrics.totalResponseTime': { $exists: true }
      }
    },
    {
      $group: {
        _id: '$action',
        avgResponseTime: { $avg: '$details.performanceMetrics.totalResponseTime' },
        minResponseTime: { $min: '$details.performanceMetrics.totalResponseTime' },
        maxResponseTime: { $max: '$details.performanceMetrics.totalResponseTime' },
        count: { $sum: 1 }
      }
    }
  ]);
};

auditLogSchema.statics.getCacheEfficiency = function(timeWindow = 24) {
  const since = new Date(Date.now() - timeWindow * 60 * 60 * 1000);
  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: since },
        action: { $in: ['cache_hit', 'cache_miss'] }
      }
    },
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 }
      }
    }
  ]);
};

// Indexes for better performance
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ sessionId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ severity: 1, timestamp: -1 });

// TTL index - keep logs for 90 days
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
