require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { JWSauthenticate } = require("./JWTtoken");

// Configure AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  // accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  // secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
  "Access-Control-Allow-Credentials": true
};


const cognito = new AWS.CognitoIdentityServiceProvider();

const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'Users';

const generateSecretHash = (username, clientId, clientSecret) => {
  if (!username || !clientId || !clientSecret) {
    throw new Error('Missing parameters for secret hash generation');
  }
  return crypto
    .createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64');
};

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

exports.jwsGetUserData = JWSauthenticate(async (event) => {
  try {
    const user = event.user;
    console.log('Fetching user data for:', user.username);
    
    const body = JSON.parse(event.body || "{}");
    const { user_id } = body;

    if (!user_id) {
      return createResponse(400, {
        success: false,
        message: 'User ID is required'
      });
    }

    // Get session from DynamoDB
    const sessionResult = await dynamoDB.get({
      TableName: SESSIONS_TABLE,
      Key: { 'user_id': user_id }
    }).promise();

    if (!sessionResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'User not found in session table'
      });
    }

    const session = sessionResult.Item;

    const userParams = {
      UserPoolId: USER_POOL_ID,
      Username: session.email || session.phoneNumber
    }


    const userResult = await cognito.adminGetUser(userParams).promise();

    // Format user attributes
    const userAttributes = {};
    userResult.UserAttributes.forEach(attr => {
      userAttributes[attr.Name] = attr.Value;
    });

    const userData = {
      userId: userAttributes.sub,
      email: userAttributes.email,
      firstName: userAttributes.given_name,
      lastName: userAttributes.family_name,
      phone: userAttributes.phone_number,
      emailVerified: userAttributes.email_verified === 'true',
      phoneVerified: userAttributes.phone_number_verified === 'true',
      status: userResult.UserStatus,
      createdDate: userResult.UserCreateDate,
      lastModifiedDate: userResult.UserLastModifiedDate,
      confirmationStatus: session.confirmationStatus
    };

    return createResponse(200, {
      success: true,
      message: 'User data retrieved successfully',
      data: userData
    });

  } catch (error) {
    console.error('Get User Data Error:', error);

    let message = 'Failed to retrieve user data';
    let statusCode = 500;

    if (error.code === 'UserNotFoundException') {
      message = 'User not found in Cognito.';
      statusCode = 404;
    } else if (error.code === 'InvalidParameterException') {
      message = 'Invalid parameters provided.';
      statusCode = 400;
    }
    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
});
