const mongoose = require('mongoose');

const orderCacheSchema = new mongoose.Schema({
  orderId: {
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
  status: {
    type: String,
    required: true,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']
  },
  orderData: {
    items: [{
      productId: String,
      name: String,
      quantity: Number,
      price: Number
    }],
    totalAmount: Number,
    shippingAddress: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    },
    paymentMethod: String,
    orderDate: Date,
    estimatedDelivery: Date
  },
  cancellationEligible: {
    type: Boolean,
    required: true,
    default: true
  },
  cancellationReason: {
    type: String,
    default: null
  },
  lastChecked: {
    type: Date,
    default: Date.now
  },
  ttl: {
    type: Date,
    default: () => new Date(Date.now() + parseInt(process.env.CACHE_TTL_SECONDS || 3600) * 1000),
    index: { expireAfterSeconds: 0 }
  },
  metadata: {
    source: {
      type: String,
      enum: ['api', 'manual', 'ai_request'],
      default: 'api'
    },
    cacheHits: {
      type: Number,
      default: 0
    },
    lastAccessed: {
      type: Date,
      default: Date.now
    }
  }
});

// Update metadata on access
orderCacheSchema.methods.recordAccess = function() {
  this.metadata.cacheHits += 1;
  this.metadata.lastAccessed = new Date();
  this.lastChecked = new Date();
  return this.save();
};

// Check if order can be cancelled
orderCacheSchema.methods.canCancel = function() {
  const nonCancellableStatuses = ['shipped', 'delivered', 'cancelled', 'refunded'];
  return this.cancellationEligible && !nonCancellableStatuses.includes(this.status);
};

// Update order status
orderCacheSchema.methods.updateStatus = function(newStatus, reason = null) {
  this.status = newStatus;
  if (newStatus === 'cancelled' && reason) {
    this.cancellationReason = reason;
    this.cancellationEligible = false;
  }
  this.lastChecked = new Date();
  return this.save();
};

// Static methods
orderCacheSchema.statics.findByOrderId = function(orderId) {
  return this.findOne({ orderId });
};

orderCacheSchema.statics.findUserOrders = function(userId, status = null) {
  const query = { 
    $or: [
      { userId },
      { customerId: userId }, // Also check customerId field
      { 'orderData.customerId': userId }
    ]
  };
  if (status) query.status = status;
  return this.find(query).sort({ lastChecked: -1 });
};

orderCacheSchema.statics.cleanupExpired = function() {
  return this.deleteMany({ ttl: { $lt: new Date() } });
};

orderCacheSchema.statics.getCacheStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalHits: { $sum: '$metadata.cacheHits' }
      }
    }
  ]);
};

// Indexes for better performance
orderCacheSchema.index({ orderId: 1, userId: 1 });
orderCacheSchema.index({ userId: 1, status: 1 });
orderCacheSchema.index({ lastChecked: -1 });

module.exports = mongoose.model('OrderCache', orderCacheSchema);
