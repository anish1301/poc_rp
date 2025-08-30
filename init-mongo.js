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

// Create orders collection index
db.orders.createIndex({ orderId: 1 });
db.orders.createIndex({ customerId: 1 });
db.orders.createIndex({ status: 1 });
db.orders.createIndex({ 'items.name': 1 });

// Insert sample orders for testing
const sampleOrders = [
  {
    orderId: 'ORD-2024-001',
    customerId: 'CUST-001',
    status: 'shipped',
    orderDate: new Date('2024-08-25'),
    estimatedDelivery: new Date('2024-08-30'),
    totalAmount: 199.99,
    items: [
      {
        productId: 'P001',
        name: 'Bluetooth Earphones',
        quantity: 1,
        price: 199.99
      }
    ],
    shippingAddress: {
      street: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'US'
    },
    customerName: 'John Doe',
    customerEmail: 'john@example.com',
    paymentMethod: 'Credit Card',
    trackingNumber: 'TRK123456789',
    currentLocation: 'Local Distribution Center',
    createdAt: new Date('2024-08-25'),
    updatedAt: new Date('2024-08-28')
  },
  {
    orderId: 'ORD-2024-002',
    customerId: 'CUST-001',
    status: 'pending',
    orderDate: new Date('2024-08-27'),
    estimatedDelivery: new Date('2024-09-03'),
    totalAmount: 899.99,
    items: [
      {
        productId: 'P002',
        name: 'Wireless Gaming Headset',
        quantity: 1,
        price: 899.99
      }
    ],
    shippingAddress: {
      street: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'US'
    },
    customerName: 'John Doe',
    customerEmail: 'john@example.com',
    paymentMethod: 'Credit Card',
    createdAt: new Date('2024-08-27'),
    updatedAt: new Date('2024-08-27')
  },
  {
    orderId: 'ORD-2024-003',
    customerId: 'CUST-001',
    status: 'delivered',
    orderDate: new Date('2024-08-20'),
    totalAmount: 299.99,
    deliveredAt: new Date('2024-08-23'),
    items: [
      {
        productId: 'P003',
        name: 'Smartphone Case',
        quantity: 2,
        price: 149.99
      }
    ],
    shippingAddress: {
      street: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'US'
    },
    customerName: 'John Doe',
    customerEmail: 'john@example.com',
    paymentMethod: 'Credit Card',
    trackingNumber: 'TRK987654321',
    currentLocation: 'Delivered',
    createdAt: new Date('2024-08-20'),
    updatedAt: new Date('2024-08-23')
  }
];

// Insert sample orders if they don't exist
sampleOrders.forEach(order => {
  db.orders.replaceOne(
    { orderId: order.orderId },
    order,
    { upsert: true }
  );
});

console.log('Database initialized successfully with sample orders');
