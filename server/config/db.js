const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // First try with authentication if MONGODB_URI is provided
    let connectionString = process.env.MONGODB_URI;
    
    if (!connectionString) {
      connectionString = 'mongodb://admin:password123@localhost:27017/poc-rp-db?authSource=admin';
      console.log('Using default MongoDB connection with authentication');
    }

    const conn = await mongoose.connect(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Test if we can actually perform operations (authentication check)
    try {
      await mongoose.connection.db.admin().ping();
      console.log('MongoDB authentication successful');
    } catch (authError) {
      console.warn('MongoDB authentication failed, trying without auth...');
      
      // Close current connection
      await mongoose.connection.close();
      
      // Try connecting without authentication as fallback
      const fallbackConn = await mongoose.connect('mongodb://localhost:27017/poc-rp-db', {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      
      console.log(`MongoDB Connected (no auth): ${fallbackConn.connection.host}`);
    }

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error('Database connection failed:', error);
    console.log('Trying fallback connection without authentication...');
    
    try {
      // Final fallback - simple connection
      const fallbackConn = await mongoose.connect('mongodb://localhost:27017/poc-rp-db', {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log(`MongoDB Connected (fallback): ${fallbackConn.connection.host}`);
    } catch (fallbackError) {
      console.error('All MongoDB connection attempts failed:', fallbackError);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
