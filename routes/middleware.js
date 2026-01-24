/**
 * Central Route Middleware
 * Common middleware functions used across all routes
 */

/**
 * Request logging middleware
 */
function requestLogger(req, res, next) {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.originalUrl;
  const userAgent = req.get('User-Agent') || 'Unknown';
  
  console.log(`[${timestamp}] ${method} ${url} - ${userAgent}`);
  next();
}

/**
 * Error handling middleware
 */
function errorHandler(err, req, res, next) {
  console.error('Route Error:', err);
  
  // Default error response
  const errorResponse = {
    success: false,
    message: 'Internal server error',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    errorResponse.message = 'Validation failed';
    errorResponse.details = err.message;
    return res.status(400).json(errorResponse);
  }
  
  if (err.name === 'UnauthorizedError') {
    errorResponse.message = 'Unauthorized access';
    return res.status(401).json(errorResponse);
  }
  
  if (err.name === 'NotFoundError') {
    errorResponse.message = 'Resource not found';
    return res.status(404).json(errorResponse);
  }
  
  // Generic server error
  res.status(500).json(errorResponse);
}

/**
 * Route not found handler
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    availableRoutes: [
      'GET /hello - Health check',
      'POST /auth/* - Authentication routes',
      'GET /users/* - User management routes',
      'GET /courses/* - Course management routes',
      'GET /materials/* - Material management routes',
      'GET /exams/* - Exam management routes'
    ],
    timestamp: new Date().toISOString()
  });
}

/**
 * CORS configuration middleware
 */
function corsConfig() {
  return {
    origin: process.env.ALLOWED_ORIGINS ? 
      process.env.ALLOWED_ORIGINS.split(',') : 
      ['http://localhost:3001', 'http://localhost:3000','http://test-series-ui.s3-website-us-east-1.amazonaws.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  };
}

/**
 * Rate limiting configuration
 */
function rateLimitConfig() {
  return {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false
  };
}

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove powered by header
  res.removeHeader('X-Powered-By');
  
  next();
}

/**
 * Request validation middleware
 */
function validateRequest(req, res, next) {
  // Basic request validation
  if (req.method === 'POST' || req.method === 'PUT') {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required for this operation',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  next();
}

/**
 * API versioning middleware
 */
function apiVersioning(req, res, next) {
  // Set API version in response headers
  res.setHeader('API-Version', '2.0.0');
  res.setHeader('API-Architecture', 'Modular');
  
  // Handle version-specific logic if needed
  const version = req.headers['api-version'] || '2.0.0';
  req.apiVersion = version;
  
  next();
}

module.exports = {
  requestLogger,
  errorHandler,
  notFoundHandler,
  corsConfig,
  rateLimitConfig,
  securityHeaders,
  validateRequest,
  apiVersioning
};