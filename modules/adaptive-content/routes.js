const express = require('express');
const { generateAdaptiveContent } = require('./controller');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

const router = express.Router();

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

// Handle OPTIONS preflight requests
router.options('/generate', (req, res) => {
  res.sendStatus(200);
});

// Generate adaptive content from uploaded file
// POST /adaptive-content/generate
// Body: { fileId, sectionNumber, topicName, contentType }
router.post('/generate', verifyJWT, generateAdaptiveContent);

module.exports = router;
