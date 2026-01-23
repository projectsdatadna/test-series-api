require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const { JWSauthenticate } = require("../../components/JWTtoken");


AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider();

const USERS_TABLE = process.env.USERS_TABLE || 'TestUsers';
const USER_POOL_ID = process.env.USER_POOL_ID;

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

// 1. Create User (Admin or Self-Signup)
async function createUser(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { 
      firstName, 
      lastName, 
      email, 
      phone, 
      roleId = 'student', 
      status = 'active',
      preferences = {},
      notificationPrefs = { email: true, push: true }
    } = JSON.parse(event.body);

    // Validation
    if (!firstName || !lastName || !email) {
      return createResponse(400, {
        success: false,
        message: 'firstName, lastName, and email are required'
      });
    }

    // Check if user already exists
    const existingUser = await dynamoDB.query({
      TableName: USERS_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    }).promise();

    if (existingUser.Items && existingUser.Items.length > 0) {
      return createResponse(409, {
        success: false,
        message: 'User with this email already exists'
      });
    }

    const userId = uuidv4();
    const fullName = `${firstName} ${lastName}`;
    const timestamp = new Date().toISOString();

    const user = {
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email: email,
      phone: phone || null,
      role_id: roleId,
      status: status,
      enrolledCourseIds: [],
      viewedMaterialIds: [],
      linkedStudentIds: [],
      preferences: {
        language: 'en',
        ttsEnabled: false,
        accessibilityOptions: {},
        ...preferences
      },
      notificationPrefs: notificationPrefs,
      created_at: timestamp,
      updated_at: timestamp
    };

    await dynamoDB.put({
      TableName: USERS_TABLE,
      Item: user
    }).promise();

    return createResponse(201, {
      success: true,
      message: 'User created successfully',
      data: {
        userId: user.user_id,
        email: user.email,
        fullName: user.full_name
      }
    });

  } catch (error) {
    console.error('CreateUser Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  }
}

// 2. Get All Users (Admin Access)
async function getAllUsers(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const status = queryParams.status;

    let params = {
      TableName: USERS_TABLE,
      Limit: limit
    };

    // Filter by status if provided
    if (status) {
      params.FilterExpression = '#status = :status';
      params.ExpressionAttributeNames = {
        '#status': 'status'
      };
      params.ExpressionAttributeValues = {
        ':status': status
      };
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.scan(params).promise();

    const response = {
      success: true,
      data: result.Items,
      count: result.Items.length
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetAllUsers Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve users',
      error: error.message
    });
  }
}

// 3. Get Single User
async function getUserById(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'User not found'
      });
    }

    return createResponse(200, {
      success: true,
      data: result.Item
    });

  } catch (error) {
    console.error('GetUser Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve user',
      error: error.message
    });
  }
}

// 4. Update User
async function updateUser(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const updates = JSON.parse(event.body);
    
    // Fields that can be updated
    const allowedFields = [
      'first_name', 'last_name', 'phone', 
      'role_id', 'status', 'preferences', 
      'notificationPrefs'
    ];

    // Build update expression
    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = {
      ':updated_at': new Date().toISOString()
    };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = updates[key];
      }
    });

    // Update full_name if first or last name changed
    if (updates.first_name || updates.last_name) {
      const currentUser = await dynamoDB.get({
        TableName: USERS_TABLE,
        Key: { user_id: userId }
      }).promise();

      if (currentUser.Item) {
        const firstName = updates.first_name || currentUser.Item.first_name;
        const lastName = updates.last_name || currentUser.Item.last_name;
        updateExpression += `, full_name = :full_name`;
        expressionAttributeValues[':full_name'] = `${firstName} ${lastName}`;
      }
    }

    const params = {
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, {
      success: true,
      message: 'User updated successfully',
      data: result.Attributes
    });

  } catch (error) {
    console.error('UpdateUser Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to update user',
      error: error.message
    });
  }
}

// 5. Delete/Deactivate User
async function deleteUser(event) {
  try {
    const userId = event.pathParameters?.userId;
    const permanent = event.queryStringParameters?.permanent === 'true';

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    if (permanent) {
      // Permanent deletion
      await dynamoDB.delete({
        TableName: USERS_TABLE,
        Key: { user_id: userId }
      }).promise();

      return createResponse(200, {
        success: true,
        message: 'User permanently deleted'
      });
    } else {
      // Soft delete - mark as deleted
      await dynamoDB.update({
        TableName: USERS_TABLE,
        Key: { user_id: userId },
        UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'deleted',
          ':updated_at': new Date().toISOString()
        }
      }).promise();

      return createResponse(200, {
        success: true,
        message: 'User marked as deleted'
      });
    }

  } catch (error) {
    console.error('DeleteUser Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to delete user',
      error: error.message
    });
  }
}

// 6. Get User Enrolled Courses
async function getUserEnrollments(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      ProjectionExpression: 'enrolledCourseIds'
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'User not found'
      });
    }

    return createResponse(200, {
      success: true,
      data: {
        userId: userId,
        enrolledCourses: result.Item.enrolledCourseIds || []
      }
    });

  } catch (error) {
    console.error('GetUserEnrollments Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve enrollments',
      error: error.message
    });
  }
}

// 7. Get User Viewed Materials
async function getUserViewedMaterials(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      ProjectionExpression: 'viewedMaterialIds'
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'User not found'
      });
    }

    return createResponse(200, {
      success: true,
      data: {
        userId: userId,
        viewedMaterials: result.Item.viewedMaterialIds || []
      }
    });

  } catch (error) {
    console.error('GetUserViewedMaterials Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve viewed materials',
      error: error.message
    });
  }
}

// 8. Update User Preferences
async function updateUserPreferences(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const preferences = JSON.parse(event.body);

    const result = await dynamoDB.update({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET preferences = :preferences, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':preferences': preferences,
        ':updated_at': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Preferences updated successfully',
      data: result.Attributes.preferences
    });

  } catch (error) {
    console.error('UpdateUserPreferences Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to update preferences',
      error: error.message
    });
  }
}

// 9. Update Notification Settings
async function updateNotificationSettings(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const notificationPrefs = JSON.parse(event.body);

    const result = await dynamoDB.update({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET notificationPrefs = :notificationPrefs, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':notificationPrefs': notificationPrefs,
        ':updated_at': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Notification settings updated successfully',
      data: result.Attributes.notificationPrefs
    });

  } catch (error) {
    console.error('UpdateNotificationSettings Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to update notification settings',
      error: error.message
    });
  }
}

// 10. Sync Cognito User to DynamoDB (Called from Cognito triggers)
async function syncCognitoUser(cognitoEvent) {
  try {
    const { userName, request } = cognitoEvent;
    const userAttributes = request.userAttributes;

    const userId = userAttributes.sub;
    const email = userAttributes.email;
    const phoneNumber = userAttributes.phone_number;
    const firstName = userAttributes.given_name || '';
    const lastName = userAttributes.family_name || '';

    // Check if user already exists
    const existingUser = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    if (existingUser.Item) {
      // Update existing user
      await dynamoDB.update({
        TableName: USERS_TABLE,
        Key: { user_id: userId },
        UpdateExpression: 'SET email = :email, phone = :phone, first_name = :firstName, last_name = :lastName, full_name = :fullName, updated_at = :updated_at',
        ExpressionAttributeValues: {
          ':email': email,
          ':phone': phoneNumber || null,
          ':firstName': firstName,
          ':lastName': lastName,
          ':fullName': `${firstName} ${lastName}`,
          ':updated_at': new Date().toISOString()
        }
      }).promise();
    } else {
      // Create new user from Cognito
      const timestamp = new Date().toISOString();
      await dynamoDB.put({
        TableName: USERS_TABLE,
        Item: {
          user_id: userId,
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`,
          email: email,
          phone: phoneNumber || null,
          role_id: 'student',
          status: 'active',
          enrolledCourseIds: [],
          viewedMaterialIds: [],
          linkedStudentIds: [],
          preferences: {
            language: 'en',
            ttsEnabled: false,
            accessibilityOptions: {}
          },
          notificationPrefs: {
            email: true,
            push: true
          },
          created_at: timestamp,
          updated_at: timestamp
        }
      }).promise();
    }

    return cognitoEvent;

  } catch (error) {
    console.error('SyncCognitoUser Error:', error);
    throw error;
  }
}

module.exports = {
  createUser,
  getAllUsers: JWSauthenticate(getAllUsers),
  getUserById: JWSauthenticate(getUserById),
  updateUser: JWSauthenticate(updateUser),
  deleteUser: JWSauthenticate(deleteUser),
  getUserEnrollments: JWSauthenticate(getUserEnrollments),
  getUserViewedMaterials: JWSauthenticate(getUserViewedMaterials),
  updateUserPreferences: JWSauthenticate(updateUserPreferences),
  updateNotificationSettings: JWSauthenticate(updateNotificationSettings),
  syncCognitoUser: JWSauthenticate(syncCognitoUser)
};
