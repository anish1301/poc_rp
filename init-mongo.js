// MongoDB initialization script
db = db.getSiblingDB('poc-rp-db');

// Create collections with indexes
db.conversations.createIndex({ sessionId: 1 });
db.conversations.createIndex({ userId: 1 });
db.conversations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

db.ordercaches.createIndex({ orderId: 1 });
db.ordercaches.createIndex({ userId: 1 });
db.ordercaches.createIndex({ orderId: 1, userId: 1 });

db.auditlogs.createIndex({ timestamp: -1 });
db.auditlogs.createIndex({ userId: 1, timestamp: -1 });
db.auditlogs.createIndex({ sessionId: 1, timestamp: -1 });
db.auditlogs.createIndex({ action: 1, timestamp: -1 });

console.log('Database initialized successfully');
