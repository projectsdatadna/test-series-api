const express = require('express');
const { generatePresignedUrl, processUploadedFile, uploadToAnthropicFromS3 } = require('./controller');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

const router = express.Router();

// JWT verification middleware
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
router.options('/generate-presigned-url', (req, res) => {
  res.sendStatus(200);
});

router.options('/process-file', (req, res) => {
  res.sendStatus(200);
});

router.options('/upload-to-anthropic', (req, res) => {
  res.sendStatus(200);
});

// Generate pre-signed URL for direct S3 upload
// POST /s3-upload/generate-presigned-url
// Body: { fileName, fileType, fileSize }
router.post('/generate-presigned-url', verifyJWT, generatePresignedUrl);

// Process file after upload to S3
// POST /s3-upload/process-file
// Body: { fileKey, fileName, fileType }
router.post('/process-file', verifyJWT, processUploadedFile);

// Upload file from S3 to Anthropic
// POST /s3-upload/upload-to-anthropic
// Body: { fileKey }
router.post('/upload-to-anthropic', verifyJWT, uploadToAnthropicFromS3);

module.exports = router;
