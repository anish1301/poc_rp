const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    // Primary connection string with authentication for Docker setup
    const primaryURI = process.env.MONGODB_URI || 'mongodb+srv://anishkumar130119:<db_password>@cluster0.ig0dl.mongodb.net/';
    
    try {
      const conn = await mongoose.connect(primaryURI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });

      console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (authError) {
      console.log('Database connection failed:', authError.message);
      console.log('Trying fallback connection without authentication...');
      
      // Fallback connection without authentication
      const fallbackURI = 'mongodb+srv://anishkumar130119:<db_password>@cluster0.ig0dl.mongodb.net/';
      const conn = await mongoose.connect(fallbackURI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });

      console.log(`MongoDB Connected (fallback): ${conn.connection.host}`);
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
    console.log('Please make sure MongoDB is running on localhost:27017');
    console.log('You can start it with Docker: docker-compose up -d mongodb');
    process.exit(1);
  }
};

module.exports = connectDB;
