const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    actionType: String, // 'order_cancellation', 'general_inquiry', etc.
    orderId: String,
    confidence: Number,
    cached: {
      type: Boolean,
      default: false
    }
  }
});

const conversationSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  messages: [messageSchema],
  context: {
    lastOrderInquiry: String,
    userPreferences: {
      type: Map,
      of: String
    },
    conversationSummary: String
  },
  status: {
    type: String,
    enum: ['active', 'ended', 'timeout'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    index: { expireAfterSeconds: 0 }
  }
});

// Update the updatedAt field before saving
conversationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance methods
conversationSchema.methods.addMessage = function(role, content, metadata = {}) {
  this.messages.push({
    role,
    content,
    metadata
  });
  
  // Keep only the last N messages to prevent infinite growth
  const maxMessages = parseInt(process.env.MAX_CONVERSATION_HISTORY) || 50;
  if (this.messages.length > maxMessages) {
    this.messages = this.messages.slice(-maxMessages);
  }
  
  return this.save();
};

conversationSchema.methods.getRecentMessages = function(limit = 10) {
  return this.messages.slice(-limit);
};

conversationSchema.methods.updateContext = function(contextUpdate) {
  this.context = { ...this.context, ...contextUpdate };
  return this.save();
};

// Static methods
conversationSchema.statics.findActiveByUser = function(userId) {
  return this.find({ userId, status: 'active' }).sort({ updatedAt: -1 });
};

conversationSchema.statics.findBySessionId = function(sessionId) {
  return this.findOne({ sessionId, status: 'active' });
};

conversationSchema.statics.cleanupExpired = function() {
  return this.deleteMany({ 
    expiresAt: { $lt: new Date() } 
  });
};

module.exports = mongoose.model('Conversation', conversationSchema);
