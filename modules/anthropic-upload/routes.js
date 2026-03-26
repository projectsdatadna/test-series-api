const express = require('express');
const { getUploadUrls, confirmUpload, uploadFile } = require('./controller');
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
      clientId: process.env.CLIENT_ID
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

// NEW: Get pre-signed URLs for S3 upload
router.post('/get-upload-urls', verifyJWT, getUploadUrls);

// NEW: Confirm upload and process files from S3
router.post('/confirm-upload', verifyJWT, confirmUpload);

// LEGACY: Keep old endpoint for backward compatibility (files < 5MB)
// This will still work for small files
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit for direct upload
});

router.post('/upload-files-direct', verifyJWT, upload.any(), uploadFile);

module.exports = router;
