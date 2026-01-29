const express = require('express');
const multer = require('multer');
const { uploadFile } = require('./controller');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

const router = express.Router();

// Configure multer for memory storage with 50MB limit (for multiple files)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB per file
});

// JWT verification middleware for Express
const verifyJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access token required',
        message: 'Please provide a valid Bearer token in Authorization header'
      });
    }

    const token = authHeader.substring(7);
    
    const verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.USER_POOL_ID,
      tokenUse: 'access',
      clientId: process.env.CLIENT_ID,
    });

    const payload = await verifier.verify(token);
    
    // Add user info to request
    req.user = {
      userId: payload.sub,
      username: payload.username,
      email: payload.email,
      clientId: payload.client_id
    };

    console.log('Authenticated user:', req.user.username);
    next();
  } catch (error) {
    console.error('JWT Verification Error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        message: 'Your access token has expired. Please sign in again.'
      });
    }
    
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      message: 'The provided token is invalid.'
    });
  }
};

// Middleware to handle both 'file' and 'files' field names
const handleFileUpload = (req, res, next) => {
  // If single file uploaded as 'file', convert to 'files' array
  if (req.file && !req.files) {
    req.files = [req.file];
  }
  next();
};

// Middleware to validate file sizes
const validateFileSizes = (req, res, next) => {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
  const files = req.files || [];
  
  const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE);
  
  if (oversizedFiles.length > 0) {
    return res.status(413).json({
      success: false,
      message: 'File size exceeds limit',
      error: `Anthropic API has a 10MB limit per file. The following files exceed this limit:`,
      oversizedFiles: oversizedFiles.map(f => ({
        filename: f.originalname,
        size: `${(f.size / 1024 / 1024).toFixed(2)}MB`,
        limit: '10MB'
      }))
    });
  }
  
  next();
};

// Handle OPTIONS preflight requests
router.options('/upload-file', (req, res) => {
  res.sendStatus(200);
});

// Upload multiple files to Anthropic
// POST /anthropic/upload-file
// Accepts both single file (field: 'file') and multiple files (field: 'files')
router.post('/upload-files', verifyJWT, upload.any(), handleFileUpload, validateFileSizes, uploadFile);

module.exports = router;
