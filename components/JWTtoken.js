require('dotenv').config();
const AWS = require("aws-sdk");
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Configure AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  // accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  // secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});



const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const USER_POOL_ID = process.env.USER_POOL_ID;

const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: CLIENT_ID,
});

const createResponse = (statusCode, body) => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,PUT,DELETE'
    },
    body: JSON.stringify(body)
  };
};



const JWSauthenticate = (handler) => {
  return async (event) => {
    console.log("JWSauthenticate middleware triggered");

    if (event.httpMethod === "OPTIONS") {
      return createResponse(200, { message: "OK" });
    }

    try {
      // Check for Authorization header
      const authHeader = event.headers?.Authorization || event.headers?.authorization;

      console.log("authHeader", event);
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return createResponse(401, {
          success: false,
          error: 'Access token required',
          message: 'Please provide a valid Bearer token in Authorization header'
        });
      }

      const token = authHeader.substring(7);

      try {
        // Verify JWT token
        const payload = await verifier.verify(token);
        
        // Add user info to event for the handler
        event.user = {
          userId: payload.sub,
          username: payload.username,
          email: payload.email,
          clientId: payload.client_id
        };

        console.log('Authenticated user:', event.user.username);

        // Call the original handler with authenticated user
        return await handler(event);

      } catch (verifyError) {
        console.error('JWT Verification Error:', verifyError);
        
        if (verifyError.name === 'TokenExpiredError') {
          return createResponse(401, {
            success: false,
            error: 'Token expired',
            message: 'Your access token has expired. Please sign in again.'
          });
        } else {
          return createResponse(401, {
            success: false,
            error: 'Invalid token',
            message: 'The provided token is invalid.'
          });
        }
      }

    } catch (error) {
      console.error('Authentication middleware error:', error);
      return createResponse(500, {
        success: false,
        message: 'Authentication error',
        error: error.message
      });
    }
  };
};

exports.JWSauthenticate = JWSauthenticate;