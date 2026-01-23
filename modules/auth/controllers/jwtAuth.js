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

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider();

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
  "Access-Control-Allow-Credentials": true
};

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

const generateSecretHash = (username, clientId, clientSecret) => {
  return crypto
    .createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64');
};



// Updated LOGIN API with JWT Tokens
async function jwtLoginEmail (event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return createResponse(400, {
        success: false,
        message: 'Email and password are required'
      });
    }

    // Cognito authentication parameters
    const authParams = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        SECRET_HASH: generateSecretHash(email, CLIENT_ID, CLIENT_SECRET)
      }
    };

    console.log('Attempting authentication for:', email);

    // Initiate auth with Cognito
    const authResult = await cognito.initiateAuth(authParams).promise();

    // Extract JWT tokens from Cognito response
    const tokens = authResult.AuthenticationResult;
    
    if (!tokens) {
      return createResponse(401, {
        success: false,
        message: 'Authentication failed - no tokens received'
      });
    }

    // Get user details
    const getUserParams = {
      UserPoolId: USER_POOL_ID,
      Username: email
    };

    const userDetails = await cognito.adminGetUser(getUserParams).promise();
    const userId = userDetails.UserAttributes.find(attr => attr.Name === 'sub').Value;
    const userName = userDetails.UserAttributes.find(attr => attr.Name === 'name')?.Value || email;

    if (!userId) {
      return createResponse(500, {
        success: false,
        message: 'Could not retrieve user ID from Cognito.'
      });
    }

    // Verify the access token (optional validation step)
    try {
      const payload = await verifier.verify(tokens.AccessToken);
      console.log('Token verified successfully for user:', payload.username);
    } catch (verifyError) {
      console.error('Token verification failed:', verifyError);
      return createResponse(500, {
        success: false,
        message: 'Token verification failed'
      });
    }

    // Optional: Store user session info in DynamoDB (for additional tracking)
    const sessionId = uuidv4();

    const sessionParams = {
      TableName: process.env.SESSIONS_TABLE || 'UserSessions',
      Item: {
        user_id: userId,
        session_id: sessionId,
        email: email,
        created_at: Date.now(),
        is_active: true,
        last_activity: Date.now(),
        login_method: 'jwt_cognito'
      }
    };

    try {
      await dynamoDB.put(sessionParams).promise();
      console.log('Session stored successfully for user:', userId);
    } catch (sessionError) {
      console.error('Failed to store session:', sessionError);
      // Don't fail login if session storage fails
    }

    // Calculate token expiration times
    const now = Date.now();
    const accessTokenExpiry = new Date(now + (24 * 60 * 60 * 1000)).toISOString();
    const idTokenExpiry = new Date(now + (24 * 60 * 60 * 1000)).toISOString();
    const refreshTokenExpiry = new Date(now + (365 * 24 * 60 * 60 * 1000)).toISOString();

    return createResponse(200, {
      success: true,
      message: 'Login successful',
      data: {
        // JWT Tokens (main authentication mechanism)
        access_token: tokens.AccessToken,
        id_token: tokens.IdToken,
        refresh_token: tokens.RefreshToken,
        token_type: 'Bearer',
        expires_in: 86400,
        
        // Token expiration info
        access_token_expires_at: accessTokenExpiry,
        id_token_expires_at: idTokenExpiry,
        refresh_token_expires_at: refreshTokenExpiry,

        token_validity: {
          access_token_days: 1,
          id_token_days: 1,
          refresh_token_days: 365
        },
        
        // User information
        user: {
          user_id: userId,
          email: email,
          username: userName
        },
        
        // Session info (optional, for tracking)
        session: {
          session_id: sessionId,
          created_at: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('Login Error:', error);

    let message = 'Login failed';
    let statusCode = 401;

    switch (error.code) {
      case 'NotAuthorizedException':
        message = 'Invalid email or password';
        break;
      case 'UserNotConfirmedException':
        message = 'Please verify your email before logging in';
        statusCode = 403;
        break;
      case 'UserNotFoundException':
        message = 'User not found';
        statusCode = 404;
        break;
      case 'InvalidParameterException':
        message = 'Invalid parameters provided';
        statusCode = 400;
        break;
      case 'TooManyRequestsException':
        message = 'Too many login attempts. Please try again later.';
        statusCode = 429;
        break;
      default:
        statusCode = 500;
        break;
    }

    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
};



//Login Email
async function jwtLoginPhone (event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { phoneNumber, password } = JSON.parse(event.body);

    if (!phoneNumber || !password) {
      return createResponse(400, {
        success: false,
        message: 'Phone number and password are required'
      });
    }

    // Format phone number to E.164 format if needed
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    // Cognito authentication parameters
    const authParams = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: formattedPhone,
        PASSWORD: password,
        SECRET_HASH: generateSecretHash(formattedPhone, CLIENT_ID, CLIENT_SECRET)
      }
    };

    console.log('Attempting authentication for phone:', formattedPhone);

    // Initiate auth with Cognito
    const authResult = await cognito.initiateAuth(authParams).promise();

    // Extract JWT tokens from Cognito response
    const tokens = authResult.AuthenticationResult;
    
    if (!tokens) {
      return createResponse(401, {
        success: false,
        message: 'Authentication failed - no tokens received'
      });
    }

    // Get user details
    const getUserParams = {
      UserPoolId: USER_POOL_ID,
      Username: formattedPhone
    };

    const userDetails = await cognito.adminGetUser(getUserParams).promise();
    const userId = userDetails.UserAttributes.find(attr => attr.Name === 'sub').Value;
    const userName = userDetails.UserAttributes.find(attr => attr.Name === 'name')?.Value || formattedPhone;
    const emailAttr = userDetails.UserAttributes.find(attr => attr.Name === 'email');
    const email = emailAttr ? emailAttr.Value : null;

    if (!userId) {
      return createResponse(500, {
        success: false,
        message: 'Could not retrieve user ID from Cognito.'
      });
    }

    // Verify the access token (optional validation step)
    try {
      const payload = await verifier.verify(tokens.AccessToken);
      console.log('Token verified successfully for user:', payload.username);
    } catch (verifyError) {
      console.error('Token verification failed:', verifyError);
      return createResponse(500, {
        success: false,
        message: 'Token verification failed'
      });
    }

    // Store user session info in DynamoDB (for additional tracking)
    const sessionId = uuidv4();

    const sessionParams = {
      TableName: process.env.SESSIONS_TABLE || 'UserSessions',
      Item: {
        user_id: userId,
        session_id: sessionId,
        phoneNumber: formattedPhone,
        email: email, // May be null if not provided
        created_at: Date.now(),
        is_active: true,
        last_activity: Date.now(),
        login_method: 'jwt_cognito_phone'
      }
    };

    try {
      await dynamoDB.put(sessionParams).promise();
      console.log('Session stored successfully for user:', userId);
    } catch (sessionError) {
      console.error('Failed to store session:', sessionError);
      // Don't fail login if session storage fails
    }

    // Calculate token expiration times
    const now = Date.now();
    const accessTokenExpiry = new Date(now + (tokens.ExpiresIn * 1000)).toISOString();
    const idTokenExpiry = new Date(now + (tokens.ExpiresIn * 1000)).toISOString();
    const refreshTokenExpiry = new Date(now + (365 * 24 * 60 * 60 * 1000)).toISOString();

    return createResponse(200, {
      success: true,
      message: 'Login successful',
      data: {
        // JWT Tokens (main authentication mechanism)
        access_token: tokens.AccessToken,
        id_token: tokens.IdToken,
        refresh_token: tokens.RefreshToken,
        token_type: 'Bearer',
        expires_in: tokens.ExpiresIn,
        
        // Token expiration info
        access_token_expires_at: accessTokenExpiry,
        id_token_expires_at: idTokenExpiry,
        refresh_token_expires_at: refreshTokenExpiry,

        token_validity: {
          access_token_hours: Math.floor(tokens.ExpiresIn / 3600),
          id_token_hours: Math.floor(tokens.ExpiresIn / 3600),
          refresh_token_days: 365
        },
        
        // User information
        user: {
          user_id: userId,
          phone_number: formattedPhone,
          email: email,
          username: userName,
          sub: userId // Store sub for refresh token
        },
        
        // Session info (optional, for tracking)
        session: {
          session_id: sessionId,
          created_at: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('Phone Login Error:', error);

    let message = 'Login failed';
    let statusCode = 401;

    switch (error.code) {
      case 'NotAuthorizedException':
        message = 'Invalid phone number or password';
        break;
      case 'UserNotConfirmedException':
        message = 'Please verify your phone number before logging in';
        statusCode = 403;
        break;
      case 'UserNotFoundException':
        message = 'User not found';
        statusCode = 404;
        break;
      case 'InvalidParameterException':
        message = 'Invalid parameters provided';
        statusCode = 400;
        break;
      case 'TooManyRequestsException':
        message = 'Too many login attempts. Please try again later.';
        statusCode = 429;
        break;
      default:
        statusCode = 500;
        break;
    }

    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
};


async function refreshToken(event) {
  try {
    const { refresh_token, username } = JSON.parse(event.body);

    if (!refresh_token || !username) {
      return createResponse(400, {
        success: false,
        message: 'Refresh token and username are required'
      });
    }

    const refreshParams = {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refresh_token,
        SECRET_HASH: generateSecretHash('', CLIENT_ID, CLIENT_SECRET)
      }
    };

    const refreshResult = await cognito.initiateAuth(refreshParams).promise();
    const newTokens = refreshResult.AuthenticationResult;

    const accessTokenExpiry = new Date(Date.now() + (newTokens.ExpiresIn * 1000)).toISOString();

    return createResponse(200, {
      success: true,
      message: 'Token refreshed successfully',
      data: {
        access_token: newTokens.AccessToken,
        id_token: newTokens.IdToken,
        token_type: 'Bearer',
        expires_in: newTokens.ExpiresIn,
        access_token_expires_at: accessTokenExpiry,
        refresh_token // Reuse same refresh token
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);

    if (error.code === 'NotAuthorizedException') {
      return createResponse(401, {
        success: false,
        message: 'Refresh token expired or invalid. Please login again.',
        error_code: 'REFRESH_TOKEN_EXPIRED'
      });
    }

    return createResponse(500, {
      success: false,
      message: 'Token refresh failed',
      error: error.message
    });
  }
}




async function jwtEmailLogout (event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const { email } = body;


    if (!email) {
      return createResponse(400, {
        success: false,
        message: 'Email is required'
      });
    }

    const getUserParams = {
      UserPoolId: USER_POOL_ID,
      Username: email
    }
    await cognito.adminGetUser(getUserParams).promise();

    const signOutParams = {
      UserPoolId: USER_POOL_ID,
      Username: email
    };
   
    await cognito.adminUserGlobalSignOut(signOutParams).promise();

    return createResponse(200, {
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout Error:', error);

    let message = 'Failed to logout';
    let statusCode = 500;
    switch (error.code) {
      case 'UserNotFoundException':
        message = 'User not found';
        statusCode = 404;
        break;
      case 'NotAuthorizedException':
        message = 'Operation not authorized';
        statusCode = 403;
        break;
      default:
        message = 'Failed to logout';
        statusCode = 500;
        break;
    }
    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
};

async function jwtPhoneLogout (event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const { phoneNumber } = body;

    if (!phoneNumber) {
      return createResponse(400, {
        success: false,
        message: 'Phone number is required'
      });
    }

    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    const getUserParams = {
      UserPoolId: USER_POOL_ID,
      Username: formattedPhone
    };
    
    await cognito.adminGetUser(getUserParams).promise();

    const signOutParams = {
      UserPoolId: USER_POOL_ID,
      Username: formattedPhone
    };
   
    await cognito.adminUserGlobalSignOut(signOutParams).promise();

    return createResponse(200, {
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout Error:', error);

    let message = 'Failed to logout';
    let statusCode = 500;
    
    switch (error.code) {
      case 'UserNotFoundException':
        message = 'User not found';
        statusCode = 404;
        break;
      case 'NotAuthorizedException':
        message = 'Operation not authorized';
        statusCode = 403;
        break;
      default:
        message = 'Failed to logout';
        statusCode = 500;
        break;
    }
    
    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
};


// email reset password
async function jwtResetPasswordEmail(event) {
    try {
        if (!event || !event.body) {
            return createResponse(400, {
                success: false,
                message: 'Request body is required'
            });
        }

        const {
            email,
            newPassword
        } = JSON.parse(event.body);

        if (!email || !newPassword) {
            return createResponse(400, {
                success: false,
                message: 'email and newPassword are required'
            });
        }

        if (!process.env.USER_POOL_ID) {
            console.error('Missing USER_POOL_ID environment variable');
            return createResponse(500, {
                success: false,
                message: 'Server configuration error'
            });
        }

        const params = {
            UserPoolId: process.env.USER_POOL_ID,
            Username: email,
            Password: newPassword,
            Permanent: false
        };

        await cognito.adminSetUserPassword(params);

        return createResponse(200, {
            success: true,
            message: 'Password has been reset successfully. The user will be required to create a new one on their next login.'
        });

    } catch (error) {
        console.error('AdminResetPassword Error:', error);

        let message = 'Failed to reset password.';
        let statusCode = 500;

        switch (error.code) {
            case 'InvalidPasswordException':
                message = 'Password does not meet security requirements.';
                statusCode = 400;
                break;
            case 'UserNotFoundException':
                message = 'The provided email is not valid.';
                statusCode = 400;
                break;
            case 'NotAuthorizedException':
                message = 'Not authorized to perform this administrative action.';
                statusCode = 403;
                break;
            default:
                message = 'Failed to reset password.';
                statusCode = 500;
                break;
        }

        return createResponse(statusCode, {
            success: false,
            message: message,
            error: error.message
        });
    }
};


// Admin Reset Password for Phone Number
async function jwtResetPasswordPhone (event) {
    try {
        if (!event || !event.body) {
            return createResponse(400, {
                success: false,
                message: 'Request body is required'
            });
        }

        const { phoneNumber, newPassword } = JSON.parse(event.body);

        if (!phoneNumber || !newPassword) {
            return createResponse(400, {
                success: false,
                message: 'phoneNumber and newPassword are required'
            });
        }

        if (!process.env.USER_POOL_ID) {
            console.error('Missing USER_POOL_ID environment variable');
            return createResponse(500, {
                success: false,
                message: 'Server configuration error'
            });
        }

        // Format phone number to E.164 format
        const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

        const params = {
            UserPoolId: process.env.USER_POOL_ID,
            Username: formattedPhone,
            Password: newPassword,
            Permanent: false // User must change on next login
        };

        await cognito.adminSetUserPassword(params).promise();

        return createResponse(200, {
            success: true,
            message: 'Password has been reset successfully. The user will be required to create a new one on their next login.'
        });

    } catch (error) {
        console.error('AdminResetPassword Phone Error:', error);

        let message = 'Failed to reset password.';
        let statusCode = 500;

        switch (error.code) {
            case 'InvalidPasswordException':
                message = 'Password does not meet security requirements.';
                statusCode = 400;
                break;
            case 'UserNotFoundException':
                message = 'The provided phone number is not valid.';
                statusCode = 400;
                break;
            case 'NotAuthorizedException':
                message = 'Not authorized to perform this administrative action.';
                statusCode = 403;
                break;
            default:
                message = 'Failed to reset password.';
                statusCode = 500;
                break;
        }

        return createResponse(statusCode, {
            success: false,
            message: message,
            error: error.message
        });
    }
};

// resend confirmation code

async function jwtResendConfirmationCode (event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return createResponse(200, {});
    }

    const { email } = JSON.parse(event.body);

    // Validate required fields
    if (!email) {
      return createResponse(400, {
        success: false,
        message: 'Email is required'
      });
    }

    if (!CLIENT_ID || !CLIENT_SECRET || !USER_POOL_ID) {
      console.error('Missing required environment variables');
      return createResponse(500, {
        success: false,
        message: 'Server configuration error'
      });
    }

    // First, check if user exists and get their status
    let userExists = false;
    let userConfirmed = false;
    
    try {
      const getUserParams = {
        UserPoolId: USER_POOL_ID,
        Username: email
      };

      const userDetails = await cognito.adminGetUser(getUserParams).promise();
      userExists = true;
      userConfirmed = userDetails.UserStatus === 'CONFIRMED';
      
      console.log('User found:', {
        username: email,
        status: userDetails.UserStatus,
        enabled: userDetails.Enabled
      });

    } catch (getUserError) {
      console.error('Get User Error:', getUserError);
      
      if (getUserError.code === 'UserNotFoundException') {
        return createResponse(404, {
          success: false,
          message: 'No account found with this email address. Please sign up first.'
        });
      }
      
      // Handle other errors
      return createResponse(500, {
        success: false,
        message: 'Failed to verify user status',
        error: getUserError.message
      });
    }

    // If user is already confirmed
    if (userConfirmed) {
      return createResponse(409, {
        success: false,
        message: 'This account is already verified. You can log in directly.'
      });
    }

    // Resend confirmation code
    const resendParams = {
      ClientId: CLIENT_ID,
      Username: email,
      SecretHash: generateSecretHash(email, CLIENT_ID, CLIENT_SECRET)
    };

    try {
      await cognito.resendConfirmationCode(resendParams).promise();
      
      console.log('Confirmation code resent successfully for:', email);

      return createResponse(200, {
        success: true,
        message: 'Confirmation code has been resent to your email address. Please check your inbox and spam folder.',
        data: {
          email: email,
          action: 'confirmation_code_resent'
        }
      });

    } catch (resendError) {
      console.error('Resend Confirmation Code Error:', resendError);
      
      let message = 'Failed to resend confirmation code';
      let statusCode = 500;

      switch (resendError.code) {
        case 'UserNotFoundException':
          message = 'No account found with this email address';
          statusCode = 404;
          break;
        case 'InvalidParameterException':
          message = 'Invalid email address provided';
          statusCode = 400;
          break;
        case 'LimitExceededException':
          message = 'Too many requests. Please wait before requesting another code.';
          statusCode = 429;
          break;
        case 'TooManyRequestsException':
          message = 'Too many requests. Please try again later.';
          statusCode = 429;
          break;
        case 'NotAuthorizedException':
          message = 'Unable to resend confirmation code. Please contact support.';
          statusCode = 403;
          break;
        case 'CodeDeliveryFailureException':
          message = 'Failed to deliver confirmation code. Please check your email address.';
          statusCode = 502;
          break;
        default:
          message = 'Failed to resend confirmation code';
          statusCode = 500;
      }

      return createResponse(statusCode, {
        success: false,
        message: message,
        error: resendError.message
      });
    }

  } catch (error) {
    console.error('Resend Confirmation Code Function Errors:', error);
    
    return createResponse(500, {
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Resend Confirmation Code for Phone Number (SMS)
async function jwtResendConfirmationCodePhone (event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return createResponse(200, {});
    }

    const { phoneNumber } = JSON.parse(event.body);

    // Validate required fields
    if (!phoneNumber) {
      return createResponse(400, {
        success: false,
        message: 'Phone number is required'
      });
    }

    if (!CLIENT_ID || !CLIENT_SECRET || !USER_POOL_ID) {
      console.error('Missing required environment variables');
      return createResponse(500, {
        success: false,
        message: 'Server configuration error'
      });
    }

    // Format phone number to E.164 format
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    // First, check if user exists and get their status
    let userExists = false;
    let userConfirmed = false;
    
    try {
      const getUserParams = {
        UserPoolId: USER_POOL_ID,
        Username: formattedPhone
      };

      const userDetails = await cognito.adminGetUser(getUserParams).promise();
      userExists = true;
      userConfirmed = userDetails.UserStatus === 'CONFIRMED';
      
      console.log('User found:', {
        username: formattedPhone,
        status: userDetails.UserStatus,
        enabled: userDetails.Enabled
      });

    } catch (getUserError) {
      console.error('Get User Error:', getUserError);
      
      if (getUserError.code === 'UserNotFoundException') {
        return createResponse(404, {
          success: false,
          message: 'No account found with this phone number. Please sign up first.'
        });
      }
      
      // Handle other errors
      return createResponse(500, {
        success: false,
        message: 'Failed to verify user status',
        error: getUserError.message
      });
    }

    // If user is already confirmed
    if (userConfirmed) {
      return createResponse(409, {
        success: false,
        message: 'This account is already verified. You can log in directly.'
      });
    }

    // Resend confirmation code via SMS
    const resendParams = {
      ClientId: CLIENT_ID,
      Username: formattedPhone,
      SecretHash: generateSecretHash(formattedPhone, CLIENT_ID, CLIENT_SECRET)
    };

    try {
      const result = await cognito.resendConfirmationCode(resendParams).promise();
      
      console.log('Confirmation code resent successfully for:', formattedPhone);
      console.log('Delivery medium:', result.CodeDeliveryDetails?.DeliveryMedium);

      return createResponse(200, {
        success: true,
        message: 'Verification code has been resent to your phone number via SMS. Please check your messages.',
        data: {
          phoneNumber: formattedPhone,
          action: 'confirmation_code_resent',
          deliveryMedium: result.CodeDeliveryDetails?.DeliveryMedium || 'SMS',
          destination: result.CodeDeliveryDetails?.Destination
        }
      });

    } catch (resendError) {
      console.error('Resend Confirmation Code Phone Error:', resendError);
      
      let message = 'Failed to resend confirmation code';
      let statusCode = 500;

      switch (resendError.code) {
        case 'UserNotFoundException':
          message = 'No account found with this phone number';
          statusCode = 404;
          break;
        case 'InvalidParameterException':
          message = 'Invalid phone number provided. Ensure it is in E.164 format (e.g., +916382490453)';
          statusCode = 400;
          break;
        case 'LimitExceededException':
          message = 'Too many requests. Please wait before requesting another code.';
          statusCode = 429;
          break;
        case 'TooManyRequestsException':
          message = 'Too many requests. Please try again later.';
          statusCode = 429;
          break;
        case 'NotAuthorizedException':
          message = 'Unable to resend confirmation code. Please contact support.';
          statusCode = 403;
          break;
        case 'CodeDeliveryFailureException':
          message = 'Failed to deliver SMS confirmation code. Please verify your phone number is correct and can receive SMS.';
          statusCode = 502;
          break;
        case 'InvalidSmsRoleAccessPolicyException':
          message = 'SMS service is not properly configured. Please contact administrator.';
          statusCode = 500;
          break;
        case 'InvalidSmsRoleTrustRelationshipException':
          message = 'SMS service configuration error. Please contact administrator.';
          statusCode = 500;
          break;
        default:
          message = 'Failed to resend confirmation code';
          statusCode = 500;
      }

      return createResponse(statusCode, {
        success: false,
        message: message,
        error: resendError.message
      });
    }

  } catch (error) {
    console.error('Resend Confirmation Code Phone Function Error:', error);
    
    return createResponse(500, {
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};


async function jwtResendPhoneAttributeVerification(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const body = JSON.parse(event.body);
    const { accessToken } = body;

    if (!accessToken) {
      return createResponse(400, {
        success: false,
        message: 'Access token is required'
      });
    }

    // This API is used when a CONFIRMED user wants to verify a new phone number
    const params = {
      AccessToken: accessToken,
      AttributeName: 'phone_number'
    };

    try {
      const result = await cognito.getUserAttributeVerificationCode(params).promise();
      
      console.log('Phone verification code resent for attribute update');

      return createResponse(200, {
        success: true,
        message: 'Verification code has been sent to your new phone number via SMS.',
        data: {
          deliveryMedium: result.CodeDeliveryDetails?.DeliveryMedium || 'SMS',
          destination: result.CodeDeliveryDetails?.Destination,
          attributeName: result.CodeDeliveryDetails?.AttributeName
        }
      });

    } catch (error) {
      console.error('Resend Phone Attribute Verification Error:', error);
      
      let message = 'Failed to send verification code';
      let statusCode = 500;

      switch (error.code) {
        case 'NotAuthorizedException':
          message = 'Invalid or expired access token. Please login again.';
          statusCode = 401;
          break;
        case 'LimitExceededException':
          message = 'Too many requests. Please wait before requesting another code.';
          statusCode = 429;
          break;
        case 'TooManyRequestsException':
          message = 'Too many requests. Please try again later.';
          statusCode = 429;
          break;
        case 'InvalidParameterException':
          message = 'Invalid parameters. Phone number may not be set for this user.';
          statusCode = 400;
          break;
        case 'CodeDeliveryFailureException':
          message = 'Failed to deliver SMS verification code.';
          statusCode = 502;
          break;
        default:
          message = 'Failed to send verification code';
          statusCode = 500;
      }

      return createResponse(statusCode, {
        success: false,
        message: message,
        error: error.message
      });
    }

  } catch (error) {
    console.error('Resend Phone Attribute Verification Function Error:', error);
    
    return createResponse(500, {
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

async function jwtResetPasswordWithOld (event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const { email, oldPassword, newPassword } = JSON.parse(event.body);

    if (!email || !oldPassword || !newPassword) {
      return createResponse(400, { success: false, message: 'email, oldPassword, and newPassword are required' });
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('Missing CLIENT_ID or CLIENT_SECRET environment variables');
      return createResponse(500, { success: false, message: 'Server configuration error' });
    }

    // Step 1: Authenticate user using old password to verify oldPassword is correct
    const authParams = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: oldPassword,
        SECRET_HASH: generateSecretHash(email, CLIENT_ID, CLIENT_SECRET),
      },
    };

    const authResponse = await cognito.initiateAuth(authParams).promise();

    // Step 2: Use the returned AccessToken to change the password
    const accessToken = authResponse.AuthenticationResult.AccessToken;

    const changePasswordParams = {
      PreviousPassword: oldPassword,
      ProposedPassword: newPassword,
      AccessToken: accessToken,
    };

    await cognito.changePassword(changePasswordParams).promise();

    return createResponse(200, {
      success: true,
      message: 'Password has been changed successfully'
    });

  } catch (error) {
    console.error('Reset Password with Old Password Error:', error);

    let message = 'Failed to reset password.';
    let statusCode = 500;

    switch (error.code) {
      case 'NotAuthorizedException':
        message = 'Old password is incorrect or user not authorized.';
        statusCode = 403;
        break;
      case 'InvalidPasswordException':
        message = 'New password does not meet security requirements.';
        statusCode = 400;
        break;
      case 'UserNotFoundException':
        message = 'User does not exist.';
        statusCode = 404;
        break;
      case 'LimitExceededException':
      case 'TooManyRequestsException':
        message = 'Too many requests. Please try again later.';
        statusCode = 429;
        break;
      default:
        message = 'Failed to reset password.';
        statusCode = 500;
        break;
    }

    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
};

async function jwtResetPasswordWithOldPhone (event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const { phoneNumber, oldPassword, newPassword } = JSON.parse(event.body);

    if (!phoneNumber || !oldPassword || !newPassword) {
      return createResponse(400, {
        success: false,
        message: 'phoneNumber, oldPassword, and newPassword are required'
      });
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('Missing CLIENT_ID or CLIENT_SECRET environment variables');
      return createResponse(500, { success: false, message: 'Server configuration error' });
    }

    // Format phone number if needed (e.g., E.164)
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    // Step 1: Authenticate user using old password to verify oldPassword is correct
    const authParams = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: formattedPhone,
        PASSWORD: oldPassword,
        SECRET_HASH: generateSecretHash(formattedPhone, CLIENT_ID, CLIENT_SECRET),
      },
    };

    const authResponse = await cognito.initiateAuth(authParams).promise();

    // Step 2: Use the returned AccessToken to change the password
    const accessToken = authResponse.AuthenticationResult.AccessToken;

    const changePasswordParams = {
      PreviousPassword: oldPassword,
      ProposedPassword: newPassword,
      AccessToken: accessToken,
    };

    await cognito.changePassword(changePasswordParams).promise();

    return createResponse(200, {
      success: true,
      message: 'Password has been changed successfully using phone number'
    });

  } catch (error) {
    console.error('Reset Password with Old Password Phone Error:', error);

    let message = 'Failed to reset password.';
    let statusCode = 500;

    switch (error.code) {
      case 'NotAuthorizedException':
        message = 'Old password is incorrect or user not authorized.';
        statusCode = 403;
        break;
      case 'InvalidPasswordException':
        message = 'New password does not meet security requirements.';
        statusCode = 400;
        break;
      case 'UserNotFoundException':
        message = 'User does not exist.';
        statusCode = 404;
        break;
      case 'LimitExceededException':
      case 'TooManyRequestsException':
        message = 'Too many requests. Please try again later.';
        statusCode = 429;
        break;
      default:
        message = 'Failed to reset password.';
        statusCode = 500;
        break;
    }

    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
};


module.exports = {
  jwtLoginEmail,
  jwtLoginPhone,
  refreshToken,
  jwtEmailLogout,
  jwtPhoneLogout,
  jwtResetPasswordEmail,
  jwtResetPasswordPhone,
  jwtResendConfirmationCode,
  jwtResendConfirmationCodePhone,
  jwtResendPhoneAttributeVerification,
  jwtResetPasswordWithOld,
  jwtResetPasswordWithOldPhone,
};
