require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider();

const USER_SESSIONS_TABLE = process.env.USER_SESSIONS_TABLE || 'UserSessions';
const USERS_TABLE = process.env.USERS_TABLE || 'Users';
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
const SESSION_EXPIRY_HOURS = parseInt(process.env.SESSION_EXPIRY_HOURS) || 24;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
  "Access-Control-Allow-Credentials": true
};

const createResponse = (statusCode, body) => {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
};

// Generate secret hash for Cognito
const generateSecretHash = (username, clientId, clientSecret) => {
  return crypto
    .createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64');
};

// Hash token for storage
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Extract device info from user agent
const extractDeviceInfo = (userAgent) => {
  if (!userAgent) return 'Unknown Device';
  
  let device = 'Desktop';
  let os = 'Unknown';
  let browser = 'Unknown';

  // Detect OS
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'MacOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

  // Detect Device Type
  if (userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone')) {
    device = 'Mobile';
  } else if (userAgent.includes('Tablet') || userAgent.includes('iPad')) {
    device = 'Tablet';
  }

  // Detect Browser
  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Edge')) browser = 'Edge';

  return `${device} - ${os} - ${browser}`;
};

// Get IP address from event
const getIpAddress = (event) => {
  if (event.headers) {
    return event.headers['X-Forwarded-For'] || 
           event.headers['x-forwarded-for'] || 
           event.requestContext?.identity?.sourceIp || 
           'Unknown';
  }
  return 'Unknown';
};

// 1. Login (Create Session)
async function login(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { email, password, rememberMe = false } = JSON.parse(event.body);

    if (!email || !password) {
      return createResponse(400, {
        success: false,
        message: 'Email and password are required'
      });
    }

    // Authenticate with Cognito
    const authParams = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        SECRET_HASH: generateSecretHash(email, CLIENT_ID, CLIENT_SECRET)
      }
    };

    let cognitoResponse;
    try {
      cognitoResponse = await cognito.initiateAuth(authParams).promise();
    } catch (cognitoError) {
      console.error('Cognito Auth Error:', cognitoError);
      
      let message = 'Authentication failed';
      switch (cognitoError.code) {
        case 'NotAuthorizedException':
          message = 'Incorrect email or password';
          break;
        case 'UserNotConfirmedException':
          message = 'User account not confirmed';
          break;
        case 'UserNotFoundException':
          message = 'User not found';
          break;
        case 'TooManyRequestsException':
          message = 'Too many attempts. Please try again later';
          break;
      }

      return createResponse(401, {
        success: false,
        message: message
      });
    }

    // Get user details
    const userParams = {
      AccessToken: cognitoResponse.AuthenticationResult.AccessToken
    };

    const userInfo = await cognito.getUser(userParams).promise();
    const userId = userInfo.UserAttributes.find(attr => attr.Name === 'sub').Value;

    // Get user from database
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    if (!userResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'User profile not found'
      });
    }

    // Check if user is active
    if (userResult.Item.status !== 'active') {
      return createResponse(403, {
        success: false,
        message: `Account is ${userResult.Item.status}. Please contact support.`
      });
    }

    // Extract device and IP info
    const userAgent = event.headers?.['User-Agent'] || event.headers?.['user-agent'] || '';
    const deviceInfo = extractDeviceInfo(userAgent);
    const ipAddress = getIpAddress(event);

    // Create session
    const sessionId = uuidv4();
    const accessToken = cognitoResponse.AuthenticationResult.AccessToken;
    const refreshToken = cognitoResponse.AuthenticationResult.RefreshToken;
    const idToken = cognitoResponse.AuthenticationResult.IdToken;
    
    const tokenHash = hashToken(accessToken);
    const expiresIn = rememberMe ? 30 * 24 * 60 * 60 : SESSION_EXPIRY_HOURS * 60 * 60; // 30 days or configured hours
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const session = {
      session_id: sessionId,
      user_id: userId,
      token_sha: tokenHash,
      device_info: deviceInfo,
      ip_address: ipAddress,
      last_active_at: new Date().toISOString(),
      is_active: true,
      expires_at: expiresAt,
      created_at: new Date().toISOString()
    };

    await dynamoDB.put({
      TableName: USER_SESSIONS_TABLE,
      Item: session
    }).promise();

    // Clean up old inactive sessions (keep only last 5 active sessions)
    await cleanupOldSessions(userId, 5);

    return createResponse(200, {
      success: true,
      message: 'Login successful',
      data: {
        sessionId: sessionId,
        accessToken: accessToken,
        refreshToken: refreshToken,
        idToken: idToken,
        expiresIn: expiresIn,
        user: {
          userId: userId,
          email: userResult.Item.email,
          fullName: userResult.Item.full_name,
          roleId: userResult.Item.role_id,
          status: userResult.Item.status
        }
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
}

// 2. Logout (End Session)
async function logout(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { sessionId, accessToken } = JSON.parse(event.body);

    if (!sessionId) {
      return createResponse(400, {
        success: false,
        message: 'sessionId is required'
      });
    }

    // Get session
    const sessionResult = await dynamoDB.get({
      TableName: USER_SESSIONS_TABLE,
      Key: { session_id: sessionId }
    }).promise();

    if (!sessionResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'Session not found'
      });
    }

    // Mark session as inactive
    await dynamoDB.update({
      TableName: USER_SESSIONS_TABLE,
      Key: { session_id: sessionId },
      UpdateExpression: 'SET is_active = :false, logged_out_at = :loggedOut',
      ExpressionAttributeValues: {
        ':false': false,
        ':loggedOut': new Date().toISOString()
      }
    }).promise();

    // Optionally sign out from Cognito (global sign out)
    if (accessToken) {
      try {
        await cognito.globalSignOut({
          AccessToken: accessToken
        }).promise();
      } catch (cognitoError) {
        console.error('Cognito SignOut Error:', cognitoError);
        // Continue even if Cognito sign out fails
      }
    }

    return createResponse(200, {
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  }
}

// 3. Validate Token
async function validateToken(event) {
  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createResponse(401, {
        success: false,
        message: 'Authorization token required'
      });
    }

    const token = authHeader.substring(7);
    const tokenHash = hashToken(token);

    // Find session with this token
    const sessions = await dynamoDB.scan({
      TableName: USER_SESSIONS_TABLE,
      FilterExpression: 'token_sha = :tokenHash AND is_active = :true',
      ExpressionAttributeValues: {
        ':tokenHash': tokenHash,
        ':true': true
      }
    }).promise();

    if (!sessions.Items || sessions.Items.length === 0) {
      return createResponse(401, {
        success: false,
        message: 'Invalid or expired token'
      });
    }

    const session = sessions.Items[0];

    // Check if session has expired
    if (new Date(session.expires_at) < new Date()) {
      await dynamoDB.update({
        TableName: USER_SESSIONS_TABLE,
        Key: { session_id: session.session_id },
        UpdateExpression: 'SET is_active = :false',
        ExpressionAttributeValues: {
          ':false': false
        }
      }).promise();

      return createResponse(401, {
        success: false,
        message: 'Session expired'
      });
    }

    // Validate with Cognito
    try {
      const userInfo = await cognito.getUser({
        AccessToken: token
      }).promise();

      // Update last active time
      await dynamoDB.update({
        TableName: USER_SESSIONS_TABLE,
        Key: { session_id: session.session_id },
        UpdateExpression: 'SET last_active_at = :now',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString()
        }
      }).promise();

      const userId = userInfo.UserAttributes.find(attr => attr.Name === 'sub').Value;

      // Get user details
      const userResult = await dynamoDB.get({
        TableName: USERS_TABLE,
        Key: { user_id: userId }
      }).promise();

      return createResponse(200, {
        success: true,
        message: 'Token is valid',
        data: {
          sessionId: session.session_id,
          userId: userId,
          user: userResult.Item ? {
            email: userResult.Item.email,
            fullName: userResult.Item.full_name,
            roleId: userResult.Item.role_id,
            status: userResult.Item.status
          } : null,
          sessionInfo: {
            deviceInfo: session.device_info,
            ipAddress: session.ip_address,
            lastActive: session.last_active_at,
            expiresAt: session.expires_at
          }
        }
      });

    } catch (cognitoError) {
      console.error('Cognito Validation Error:', cognitoError);
      
      // Mark session as inactive
      await dynamoDB.update({
        TableName: USER_SESSIONS_TABLE,
        Key: { session_id: session.session_id },
        UpdateExpression: 'SET is_active = :false',
        ExpressionAttributeValues: {
          ':false': false
        }
      }).promise();

      return createResponse(401, {
        success: false,
        message: 'Token validation failed'
      });
    }

  } catch (error) {
    console.error('ValidateToken Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Token validation failed',
      error: error.message
    });
  }
}

// 4. Get Active Sessions for a User
async function getActiveSessions(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    // Get all sessions for user
    const result = await dynamoDB.query({
      TableName: USER_SESSIONS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: 'is_active = :true',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':true': true
      }
    }).promise();

    // Sort by last active (most recent first)
    const sessions = result.Items.sort((a, b) => 
      new Date(b.last_active_at) - new Date(a.last_active_at)
    );

    return createResponse(200, {
      success: true,
      data: {
        userId: userId,
        activeSessionsCount: sessions.length,
        sessions: sessions.map(session => ({
          sessionId: session.session_id,
          deviceInfo: session.device_info,
          ipAddress: session.ip_address,
          lastActive: session.last_active_at,
          expiresAt: session.expires_at,
          createdAt: session.created_at
        }))
      }
    });

  } catch (error) {
    console.error('GetActiveSessions Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve active sessions',
      error: error.message
    });
  }
}

// 5. Get All Sessions for a User (including inactive)
async function getAllSessions(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    const params = {
      TableName: USER_SESSIONS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Limit: limit,
      ScanIndexForward: false // Sort descending
    };

    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    const response = {
      success: true,
      data: {
        userId: userId,
        sessions: result.Items,
        count: result.Items.length
      }
    };

    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetAllSessions Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve sessions',
      error: error.message
    });
  }
}

// 6. Revoke Session (Admin or User)
async function revokeSession(event) {
  try {
    const sessionId = event.pathParameters?.sessionId;

    if (!sessionId) {
      return createResponse(400, {
        success: false,
        message: 'sessionId is required'
      });
    }

    // Get session
    const sessionResult = await dynamoDB.get({
      TableName: USER_SESSIONS_TABLE,
      Key: { session_id: sessionId }
    }).promise();

    if (!sessionResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'Session not found'
      });
    }

    // Mark session as inactive
    await dynamoDB.update({
      TableName: USER_SESSIONS_TABLE,
      Key: { session_id: sessionId },
      UpdateExpression: 'SET is_active = :false, revoked_at = :revokedAt',
      ExpressionAttributeValues: {
        ':false': false,
        ':revokedAt': new Date().toISOString()
      }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Session revoked successfully'
    });

  } catch (error) {
    console.error('RevokeSession Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to revoke session',
      error: error.message
    });
  }
}

// 7. Revoke All Sessions for a User
async function revokeAllSessions(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const { exceptSessionId } = JSON.parse(event.body || '{}');

    // Get all active sessions for user
    const result = await dynamoDB.query({
      TableName: USER_SESSIONS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: 'is_active = :true',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':true': true
      }
    }).promise();

    const sessions = result.Items;
    let revokedCount = 0;

    // Revoke each session except the current one
    for (const session of sessions) {
      if (exceptSessionId && session.session_id === exceptSessionId) {
        continue; // Skip current session
      }

      await dynamoDB.update({
        TableName: USER_SESSIONS_TABLE,
        Key: { session_id: session.session_id },
        UpdateExpression: 'SET is_active = :false, revoked_at = :revokedAt',
        ExpressionAttributeValues: {
          ':false': false,
          ':revokedAt': new Date().toISOString()
        }
      }).promise();

      revokedCount++;
    }

    return createResponse(200, {
      success: true,
      message: `${revokedCount} session(s) revoked successfully`,
      data: {
        revokedCount: revokedCount,
        totalSessions: sessions.length
      }
    });

  } catch (error) {
    console.error('RevokeAllSessions Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to revoke sessions',
      error: error.message
    });
  }
}

// 8. Get Session Details
async function getSessionDetails(event) {
  try {
    const sessionId = event.pathParameters?.sessionId;

    if (!sessionId) {
      return createResponse(400, {
        success: false,
        message: 'sessionId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: USER_SESSIONS_TABLE,
      Key: { session_id: sessionId }
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'Session not found'
      });
    }

    // Get user details
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: result.Item.user_id }
    }).promise();

    return createResponse(200, {
      success: true,
      data: {
        session: result.Item,
        user: userResult.Item ? {
          userId: userResult.Item.user_id,
          email: userResult.Item.email,
          fullName: userResult.Item.full_name,
          status: userResult.Item.status
        } : null
      }
    });

  } catch (error) {
    console.error('GetSessionDetails Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve session details',
      error: error.message
    });
  }
}

// 9. Refresh Session
async function refreshSession(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { refreshToken, sessionId } = JSON.parse(event.body);

    if (!refreshToken) {
      return createResponse(400, {
        success: false,
        message: 'refreshToken is required'
      });
    }

    // Get user info from session
    let userId;
    if (sessionId) {
      const sessionResult = await dynamoDB.get({
        TableName: USER_SESSIONS_TABLE,
        Key: { session_id: sessionId }
      }).promise();

      if (sessionResult.Item) {
        userId = sessionResult.Item.user_id;
      }
    }

    // Get user email for secret hash
    let email;
    if (userId) {
      const userResult = await dynamoDB.get({
        TableName: USERS_TABLE,
        Key: { user_id: userId }
      }).promise();
      email = userResult.Item?.email;
    }

    // Refresh token with Cognito
    const authParams = {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken
      }
    };

    if (email) {
      authParams.AuthParameters.SECRET_HASH = generateSecretHash(email, CLIENT_ID, CLIENT_SECRET);
    }

    let cognitoResponse;
    try {
      cognitoResponse = await cognito.initiateAuth(authParams).promise();
    } catch (cognitoError) {
      console.error('Cognito Refresh Error:', cognitoError);
      return createResponse(401, {
        success: false,
        message: 'Token refresh failed. Please login again.'
      });
    }

    const newAccessToken = cognitoResponse.AuthenticationResult.AccessToken;
    const newIdToken = cognitoResponse.AuthenticationResult.IdToken;
    const tokenHash = hashToken(newAccessToken);

    // Update session with new token
    if (sessionId) {
      await dynamoDB.update({
        TableName: USER_SESSIONS_TABLE,
        Key: { session_id: sessionId },
        UpdateExpression: 'SET token_sha = :tokenHash, last_active_at = :now, expires_at = :expiresAt',
        ExpressionAttributeValues: {
          ':tokenHash': tokenHash,
          ':now': new Date().toISOString(),
          ':expiresAt': new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()
        }
      }).promise();
    }

    return createResponse(200, {
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        idToken: newIdToken,
        expiresIn: cognitoResponse.AuthenticationResult.ExpiresIn
      }
    });

  } catch (error) {
    console.error('RefreshSession Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Session refresh failed',
      error: error.message
    });
  }
}

// Helper: Clean up old sessions
async function cleanupOldSessions(userId, keepCount = 5) {
  try {
    const result = await dynamoDB.query({
      TableName: USER_SESSIONS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: 'is_active = :true',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':true': true
      }
    }).promise();

    const sessions = result.Items.sort((a, b) => 
      new Date(b.last_active_at) - new Date(a.last_active_at)
    );

    // Keep only the most recent sessions
    if (sessions.length > keepCount) {
      const sessionsToDeactivate = sessions.slice(keepCount);
      
      for (const session of sessionsToDeactivate) {
        await dynamoDB.update({
          TableName: USER_SESSIONS_TABLE,
          Key: { session_id: session.session_id },
          UpdateExpression: 'SET is_active = :false',
          ExpressionAttributeValues: {
            ':false': false
          }
        }).promise();
      }
    }
  } catch (error) {
    console.error('CleanupOldSessions Error:', error);
  }
}

module.exports = {
  login,
  logout,
  validateToken,
  getActiveSessions,
  getAllSessions,
  revokeSession,
  revokeAllSessions,
  getSessionDetails,
  refreshSession
};
