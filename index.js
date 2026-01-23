const express = require("express");
const serverless = require("serverless-http");
const cors = require('cors');

// Import central route registry and middleware
const { registerRoutes } = require('./routes/index');
const { 
  requestLogger, 
  errorHandler, 
  notFoundHandler, 
  corsConfig, 
  securityHeaders, 
  apiVersioning 
} = require('./routes/middleware');

const app = express();

// ============ GLOBAL MIDDLEWARE ============
// Security headers
app.use(securityHeaders);

// API versioning
app.use(apiVersioning);

// CORS configuration
app.use(cors(corsConfig()));

// Request logging
app.use(requestLogger);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============ HEALTH CHECK ROUTE ============
app.get("/hello", (req, res) => {
  res.json({ 
    message: "Hello from Express on Lambda!",
    version: "2.0.0",
    architecture: "Modular",
    totalModules: 31,
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});

// ============ REGISTER ALL MODULAR ROUTES ============
registerRoutes(app);

// ============ ERROR HANDLING ============
// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

module.exports.handler = serverless(app);