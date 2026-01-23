require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');



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
const sns = new AWS.SNS();

const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SESSIONS_TABLE = process.env.SESSIONS_TABLE;



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
  if (!username || !clientId || !clientSecret) {
    throw new Error('Missing parameters for secret hash generation');
  }
  return crypto
    .createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64');
};

// 1. Email Sign Up
async function emailsignUp(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

     if (event.httpMethod === "OPTIONS") {
       return createResponse(200, {});
     }
    // let parsedBody;
    // try {
    //   parsedBody = JSON.parse(event.body);
    // } catch (parseError) {
    //   return createResponse(400, {
    //     success: false,
    //     message: 'Invalid JSON format in request body'
    //   });
    // }

    const { email, password, firstName, lastName } = JSON.parse(event.body);

    // Validate required fields
    if (!email) {
      return createResponse(400, {
        success: false,
        message: 'Missing Email Fields'
      });
    }

    if (!firstName) {
      return createResponse(400, {
        success: false,
        message: 'Missing First Name Fields'
      });
    }

    if (!lastName) {
      return createResponse(400, {
        success: false,
        message: 'Missing Last Name Fields'
      });
    }

    if (!password) {
      return createResponse(400, {
        success: false,
        message: 'Missing Password Fields'
      });
    }

    if (!CLIENT_ID || !CLIENT_SECRET || !USER_POOL_ID) {
      console.error('Missing required environment variables');
      return createResponse(500, {
        success: false,
        message: 'Server configuration error'
      });
    }

    const formattedName = `${firstName} ${lastName}`;

    const params = {
      ClientId: CLIENT_ID,
      Username: email,
      Password: password,
      SecretHash: generateSecretHash(email, CLIENT_ID, CLIENT_SECRET), 
      UserAttributes: [
        {
          Name: 'email',
          Value: email
        },
        {
          Name: 'given_name',
          Value: firstName
        },
        {
          Name: 'family_name',
          Value: lastName
        },
        {
          Name: 'name',
          Value: formattedName
        }
      ]
    };

    console.log("Cognito SignUp Params:", params)


    let cognitoResult;
    try {
      cognitoResult = await cognito.signUp(params).promise();
    } catch (cognitoError) {
      // Edge Case 9: Handle specific Cognito errors
      console.error('Cognito SignUp Error:', cognitoError);
      
      let message = 'Failed to create user account';
      let statusCode = 500;

      console.log('Cognito Error:', cognitoError);

      switch (cognitoError.code) {
        case 'UsernameExistsException':
          message = 'An account with this email already exists. Please log in.';
          statusCode = 409;
          break;
        case 'InvalidPasswordException':
          message = 'Password does not meet security requirements';
          statusCode = 400;
          break;
        case 'InvalidParameterException':
          message = 'Invalid account information provided';
          statusCode = 400;
          break;
        case 'TooManyRequestsException':
          message = 'Too many requests. Please try again later';
          statusCode = 429;
          break;
        case 'LimitExceededException':
          message = 'Account creation limit exceeded';
          statusCode = 429;
          break;
        case 'NotAuthorizedException':
          message = 'Account creation not authorized';
          statusCode = 403;
          break;
        default:
          message = 'Failed to create user account';
          statusCode = 500;
      }

      return createResponse(statusCode, {
        success: false,
        message: message,
        error: cognitoError.message
      });
    }

    const userData = {
      user_id: cognitoResult.UserSub,
      email: email,
      firstName: firstName,
      lastName: lastName,
      confirmationStatus: 'pending'
    };

    console.log("User Data: 1", userData)

    await dynamoDB.put({
      TableName: SESSIONS_TABLE,
      Item: userData
    }).promise();

    console.log("User Data: 2", userData)

    return createResponse(201, {
      success: true,
      message: 'User created successfully. Please check your email for verification.',
      data: {
        userId: cognitoResult.UserSub,
        email: email,
        confirmationRequired: !cognitoResult.UserConfirmed
      }
    });

  } catch (error) {
    console.error('SignUp Error:', error);
    
    let message = 'Failed to create user';
    let statusCode = 500;

    if (error.code === 'UsernameExistsException') {
      message = 'User already exists';
      statusCode = 409;
    } else if (error.code === 'InvalidPasswordException') {
      message = 'Password does not meet requirements';
      statusCode = 400;
    } else if (error.code === 'InvalidParameterException') {
      message = 'Invalid parameters provided';
      statusCode = 400;
    }

    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
};

//2. phone sign up
async function phoneSignUp(event){
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(event.body);
    } catch (parseError) {
      return createResponse(400, {
        success: false,
        message: 'Invalid JSON format in request body'
      });
    }

    const { phoneNumber, firstName, lastName, password } = parsedBody;

    // Validate required fields
    if (!phoneNumber) {
      return createResponse(400, {
        success: false,
        message: 'Missing Phone Number Field'
      });
    }


    if (!firstName) {
      return createResponse(400, {
        success: false,
        message: 'Missing First Name Fields'
      });
    }

    if (!lastName) {
      return createResponse(400, {
        success: false,
        message: 'Missing Last Name Fields'
      });
    }

    if (!password) {
      return createResponse(400, {
        success: false,
        message: 'Missing Password Fields'
      });
    }

    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return createResponse(400, {
        success: false,
        message: 'Phone number must be in E.164 format (e.g., +1234567890)'
      });
    }
    
    if (!CLIENT_ID || !CLIENT_SECRET || !USER_POOL_ID) {
      console.error('Missing required environment variables');
      return createResponse(500, {
        success: false,
        message: 'Server configuration error'
      });
    }

    const formattedName = `${firstName} ${lastName}`;

    const params = {
      ClientId: CLIENT_ID,
      Username: phoneNumber,
      Password: password,
      SecretHash: generateSecretHash(phoneNumber, CLIENT_ID, CLIENT_SECRET),
      UserAttributes: [
        {
          Name: 'phone_number',
          Value: phoneNumber
        },
        {
          Name: 'given_name',
          Value: firstName
        },
        {
          Name: 'family_name',
          Value: lastName
        },
        {
          Name: 'name',
          Value: formattedName
        }
      ]
    };

    let cognitoResult;
    try {
      cognitoResult = await cognito.signUp(params).promise();
    } catch (cognitoError) {
      console.error('Cognito SignUp Error:', cognitoError);

      let message = 'Failed to create user account';
      let statusCode = 500;

      switch (cognitoError.code) {
        case 'UsernameExistsException':
          message = 'An account with this phone number already exists. Please log in.';
          statusCode = 409;
          break;
        case 'InvalidPasswordException':
          message = 'Password does not meet security requirements';
          statusCode = 400;
          break;
        case 'InvalidParameterException':
          message = 'Invalid account information provided';
          statusCode = 400;
          break;
        case 'TooManyRequestsException':
          message = 'Too many requests. Please try again later';
          statusCode = 429;
          break;
        case 'LimitExceededException':
          message = 'Account creation limit exceeded';
          statusCode = 429;
          break;
        case 'NotAuthorizedException':
          message = 'Account creation not authorized';
          statusCode = 403;
          break;
        default:
          message = 'Failed to create user account';
          statusCode = 500;
      }

      return createResponse(statusCode, {
        success: false,
        message: message,
        error: cognitoError.message
      });
    }

    const userData = {
      user_id: cognitoResult.UserSub,
      phoneNumber: phoneNumber,
      firstName: firstName,
      lastName: lastName,
      confirmationStatus: 'pending'
    };

    await dynamoDB.put({
      TableName: SESSIONS_TABLE,
      Item: userData
    }).promise();

    return createResponse(201, {
      success: true,
      message: 'User created successfully. A verification code has been sent to your phone number.',
      data: {
        userId: cognitoResult.UserSub,
        phoneNumber: phoneNumber,
        confirmationRequired: !cognitoResult.UserConfirmed
      }
    });

  } catch (error) {
    console.error('SignUp Error:', error);
    
    let message = 'Failed to create user';
    let statusCode = 500;

    if (error.code === 'UsernameExistsException') {
      message = 'User already exists';
      statusCode = 409;
    } else if (error.code === 'InvalidPasswordException') {
      message = 'Password does not meet requirements';
      statusCode = 400;
    } else if (error.code === 'InvalidParameterException') {
      message = 'Invalid parameters provided';
      statusCode = 400;
    }

    return createResponse(statusCode, {
      success: false,
      message: message,
      error: error.message
    });
  }
};


/**
 * 3. CONFIRM SIGN UP API
 * Use this to confirm a user's account with the code they received via email.
 */
async function confirmSignUp(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }
    // let parsedBody;
    // try {
    //   parsedBody = JSON.parse(event.body);
    // } catch (parseError) {
    //   return createResponse(400, {
    //     success: false,
    //     message: 'Invalid JSON format in request body'
    //   });
    // }
    const { email, confirmationCode } = JSON.parse(event.body);

    if (!email || !confirmationCode) {
      return createResponse(400, {
        success: false,
        message: 'Email and confirmation code are required'
      });
    }



    const params = {
      ClientId: CLIENT_ID,
      Username: email,
      ConfirmationCode: confirmationCode,
      SecretHash: generateSecretHash(email, CLIENT_ID, CLIENT_SECRET)
    };

    await cognito.confirmSignUp(params).promise();

    const getUserParams = {
        UserPoolId: USER_POOL_ID,
        Username: email
    };

    const userDetails = await cognito.adminGetUser(getUserParams).promise();
    const userId = userDetails.UserAttributes.find(attr => attr.Name === 'sub').Value;
    console.log("userId:", userId);
    const updateParams = {
        TableName: SESSIONS_TABLE,
        Key: { 'user_id': userId },
        UpdateExpression: 'SET confirmationStatus = :status',
        ExpressionAttributeValues: {
            ':status': 'confirmed',
        }
    };
    await dynamoDB.update(updateParams).promise();

    return createResponse(200, {
      success: true,
      message: 'User confirmed successfully.'
    });

  } catch (error) {
    console.error('ConfirmSignUp Error:', error);

    let message = 'Failed to confirm user';
    let statusCode = 500;

    switch (error.code) {
      case 'CodeMismatchException':
        message = 'Invalid confirmation code';
        statusCode = 400;
        break;
      case 'ExpiredCodeException':
        message = 'Confirmation code has expired. Please request a new one.';
        statusCode = 400;
        break;
      case 'NotAuthorizedException':
        message = 'User is not authorized';
        statusCode = 403;
        break;
      case 'LimitExceededException':
        message = 'Too many failed attempts. Please try again later.';
        statusCode = 429;
        break;
      case 'UserNotFoundException':
        message = 'User not found.';
        statusCode = 404;
        break;
      default:
        message = 'Failed to confirm user.';
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

/**
 * 4. CONFIRM SIGN UP API for Phone Number
 * Use this to confirm a user's account with the code they received via email.
 */
async function confirmPhoneSignUp(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }
    // let parsedBody;
    // try {
    //   parsedBody = JSON.parse(event.body);
    // } catch (parseError) {
    //   return createResponse(400, {
    //     success: false,
    //     message: 'Invalid JSON format in request body'
    //   });
    // }
    const { phoneNumber, confirmationCode } = JSON.parse(event.body);

    if (!phoneNumber || !confirmationCode) {
      return createResponse(400, {
        success: false,
        message: 'Phone Number and confirmation code are required'
      });
    }



    const params = {
      ClientId: CLIENT_ID,
      Username: phoneNumber,
      ConfirmationCode: confirmationCode,
      SecretHash: generateSecretHash(phoneNumber, CLIENT_ID, CLIENT_SECRET)
    };

    await cognito.confirmSignUp(params).promise();

    const getUserParams = {
        UserPoolId: USER_POOL_ID,
        Username: phoneNumber
    };

    const userDetails = await cognito.adminGetUser(getUserParams).promise();
    const userId = userDetails.UserAttributes.find(attr => attr.Name === 'sub').Value;
    console.log("userId:", userId);
    const updateParams = {
        TableName: SESSIONS_TABLE,
        Key: { 'user_id': userId },
        UpdateExpression: 'SET confirmationStatus = :status',
        ExpressionAttributeValues: {
            ':status': 'confirmed',
        }
    };
    await dynamoDB.update(updateParams).promise();

    return createResponse(200, {
      success: true,
      message: 'User confirmed successfully.'
    });

  } catch (error) {
    console.error('ConfirmSignUp Error:', error);

    let message = 'Failed to confirm user';
    let statusCode = 500;

    switch (error.code) {
      case 'CodeMismatchException':
        message = 'Invalid confirmation code';
        statusCode = 400;
        break;
      case 'ExpiredCodeException':
        message = 'Confirmation code has expired. Please request a new one.';
        statusCode = 400;
        break;
      case 'NotAuthorizedException':
        message = 'User is not authorized';
        statusCode = 403;
        break;
      case 'LimitExceededException':
        message = 'Too many failed attempts. Please try again later.';
        statusCode = 429;
        break;
      case 'UserNotFoundException':
        message = 'User not found.';
        statusCode = 404;
        break;
      default:
        message = 'Failed to confirm user.';
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




async function forgotPasswordEmail (event)  {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { email } = JSON.parse(event.body);

    if (!email) {
      return createResponse(400, {
        success: false,
        message: 'email is required'
      });
    }

    if (!CLIENT_ID || !CLIENT_SECRET || !USER_POOL_ID) {
      console.error('Missing required environment variables');
      return createResponse(500, {
        success: false,
        message: 'Server configuration error'
      });
    }

    const params = {
      ClientId: CLIENT_ID,
      Username: email,
      SecretHash: generateSecretHash(email, CLIENT_ID, CLIENT_SECRET),
    };

    await cognito.forgotPassword(params).promise();

    return createResponse(200, {
      success: true,
      message: 'A password reset code has been sent to your registered email'
    });

  } catch (error) {
    console.error('ForgotPassword Error:', error);

    let message = 'Failed to initiate password reset.';
    let statusCode = 500;

    switch (error.code) {
      case 'UserNotFoundException':
      case 'InvalidParameterException':
        message = 'The provided email is not valid.';
        statusCode = 400;
        break;
      case 'InvalidLambdaResponseException':
        message = 'The provided email is not valid or confirmed.';
        statusCode = 400;
        break;
      case 'NotAuthorizedException':
        message = 'Password reset is not authorized for this user pool or client.';
        statusCode = 403;
        break;
      case 'LimitExceededException':
        message = 'Too many requests. Please try again later.';
        statusCode = 429;
        break;
      default:
        message = 'Failed to initiate password reset.';
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

async function forgotPasswordPhone (event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { phoneNumber } = JSON.parse(event.body);

    if (!phoneNumber) {
      return createResponse(400, {
        success: false,
        message: 'Phone number is required'
      });
    }

    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    if (!CLIENT_ID || !CLIENT_SECRET || !USER_POOL_ID) {
      console.error('Missing required environment variables');
      return createResponse(500, {
        success: false,
        message: 'Server configuration error'
      });
    }

    const params = {
      ClientId: CLIENT_ID,
      Username: formattedPhone,
      SecretHash: generateSecretHash(formattedPhone, CLIENT_ID, CLIENT_SECRET),
    };

    await cognito.forgotPassword(params).promise();

    return createResponse(200, {
      success: true,
      message: 'A password reset code has been sent to your registered phone number via SMS'
    });

  } catch (error) {
    console.error('ForgotPassword Phone Error:', error);

    let message = 'Failed to initiate password reset.';
    let statusCode = 500;

    switch (error.code) {
      case 'UserNotFoundException':
      case 'InvalidParameterException':
        message = 'The provided phone number is not valid.';
        statusCode = 400;
        break;
      case 'InvalidLambdaResponseException':
        message = 'The provided phone number is not valid or confirmed.';
        statusCode = 400;
        break;
      case 'NotAuthorizedException':
        message = 'Password reset is not authorized for this user pool or client.';
        statusCode = 403;
        break;
      case 'LimitExceededException':
        message = 'Too many requests. Please try again later.';
        statusCode = 429;
        break;
      default:
        message = 'Failed to initiate password reset.';
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

// email password confirmation
async function emailForgetResetPassword (event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { email, newPassword, confirmationCode } = JSON.parse(event.body);

    if (!email || !newPassword || !confirmationCode) {
      return createResponse(400, {
        success: false,
        message: 'email, newPassword, and confirmationCode are required'
      });
    }

    if (!CLIENT_ID || !CLIENT_SECRET || !USER_POOL_ID) {
      console.error('Missing required environment variables');
      return createResponse(500, {
        success: false,
        message: 'Server configuration error'
      });
    }

    const params = {
      ClientId: CLIENT_ID,
      Username: email,
      Password: newPassword,
      ConfirmationCode: confirmationCode,
      SecretHash: generateSecretHash(email, CLIENT_ID, CLIENT_SECRET),
    };

    await cognito.confirmForgotPassword(params).promise();

    return createResponse(200, {
      success: true,
      message: 'Password has been reset successfully.'
    });

  } catch (error) {
    console.error('ResetPassword Error:', error);

    let message = 'Failed to reset password.';
    let statusCode = 500;

    switch (error.code) {
      case 'CodeMismatchException':
        message = 'Invalid or expired confirmation code.';
        statusCode = 400;
        break;
      case 'ExpiredCodeException':
        message = 'Confirmation code has expired. Please request a new one.';
        statusCode = 400;
        break;
      case 'InvalidPasswordException':
        message = 'Password does not meet security requirements.';
        statusCode = 400;
        break;
      case 'UserNotFoundException':
        message = 'The provided email is not valid.';
        statusCode = 400;
        break;
      case 'NotAuthorizedException':
        message = 'Password reset is not authorized for this user pool or client.';
        statusCode = 403;
        break;
      case 'LimitExceededException':
        message = 'Too many failed attempts. Please try again later.';
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

async function phoneForgetResetPassword (event)  {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { phoneNumber, newPassword, confirmationCode } = JSON.parse(event.body);

    if (!phoneNumber || !newPassword || !confirmationCode) {
      return createResponse(400, {
        success: false,
        message: 'phoneNumber, newPassword, and confirmationCode are required'
      });
    }

    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    if (!CLIENT_ID || !CLIENT_SECRET || !USER_POOL_ID) {
      console.error('Missing required environment variables');
      return createResponse(500, {
        success: false,
        message: 'Server configuration error'
      });
    }

    const params = {
      ClientId: CLIENT_ID,
      Username: formattedPhone,
      Password: newPassword,
      ConfirmationCode: confirmationCode,
      SecretHash: generateSecretHash(formattedPhone, CLIENT_ID, CLIENT_SECRET),
    };

    await cognito.confirmForgotPassword(params).promise();

    return createResponse(200, {
      success: true,
      message: 'Password has been reset successfully.'
    });

  } catch (error) {
    console.error('ResetPassword Phone Error:', error);

    let message = 'Failed to reset password.';
    let statusCode = 500;

    switch (error.code) {
      case 'CodeMismatchException':
        message = 'Invalid or expired confirmation code.';
        statusCode = 400;
        break;
      case 'ExpiredCodeException':
        message = 'Confirmation code has expired. Please request a new one.';
        statusCode = 400;
        break;
      case 'InvalidPasswordException':
        message = 'Password does not meet security requirements.';
        statusCode = 400;
        break;
      case 'UserNotFoundException':
        message = 'The provided phone number is not valid.';
        statusCode = 400;
        break;
      case 'NotAuthorizedException':
        message = 'Password reset is not authorized for this user pool or client.';
        statusCode = 403;
        break;
      case 'LimitExceededException':
        message = 'Too many failed attempts. Please try again later.';
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
  emailsignUp,
  phoneSignUp,
  confirmSignUp,
  confirmPhoneSignUp,
  forgotPasswordEmail,
  forgotPasswordPhone,
  emailForgetResetPassword,
  phoneForgetResetPassword
};
