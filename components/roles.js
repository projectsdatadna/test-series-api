require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const { JWSauthenticate } = require("./JWTtoken");

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const ROLES_TABLE = process.env.ROLES_TABLE || 'TestRoles';
const USERS_TABLE = process.env.USERS_TABLE || 'TestUsers';

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

// Default role permissions
const DEFAULT_PERMISSIONS = {
  admin: [
    'canManageUsers',
    'canManageRoles',
    'canManageCourses',
    'canUploadMaterial',
    'canDeleteMaterial',
    'canViewAllData',
    'canManageCategories',
    'canManageSubjects',
    'canGenerateReports',
    'canManageSettings'
  ],
  teacher: [
    'canUploadMaterial',
    'canManageCourses',
    'canViewStudentProgress',
    'canGradeAssignments',
    'canCreateQuizzes',
    'canViewReports'
  ],
  student: [
    'canViewCourses',
    'canEnrollCourses',
    'canViewMaterials',
    'canTakeQuizzes',
    'canSubmitAssignments',
    'canViewOwnProgress'
  ],
  parent: [
    'canViewLinkedStudents',
    'canViewStudentProgress',
    'canViewStudentCourses',
    'canReceiveNotifications'
  ],
  system: [
    'systemAccess',
    'canRunAutomatedTasks',
    'canAccessAPIs'
  ]
};

// 1. Create Role
async function createRole(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { roleName, permissions, description } = JSON.parse(event.body);

    // Validation
    if (!roleName) {
      return createResponse(400, {
        success: false,
        message: 'roleName is required'
      });
    }

    // Normalize role name to lowercase
    const normalizedRoleName = roleName.toLowerCase().trim();

    // Check if role already exists
    const existingRole = await dynamoDB.query({
      TableName: ROLES_TABLE,
      IndexName: 'roleName-index',
      KeyConditionExpression: 'role_name = :roleName',
      ExpressionAttributeValues: {
        ':roleName': normalizedRoleName
      }
    }).promise();

    if (existingRole.Items && existingRole.Items.length > 0) {
      return createResponse(409, {
        success: false,
        message: 'Role with this name already exists'
      });
    }

    const roleId = uuidv4();
    const timestamp = new Date().toISOString();

    // Use provided permissions or default based on role name
    const rolePermissions = permissions || DEFAULT_PERMISSIONS[normalizedRoleName] || [];

    const role = {
      role_id: roleId,
      role_name: normalizedRoleName,
      permissions: rolePermissions,
      description: description || `${normalizedRoleName} role`,
      isSystemRole: ['admin', 'teacher', 'student', 'parent', 'system'].includes(normalizedRoleName),
      created_at: timestamp,
      updated_at: timestamp
    };

    await dynamoDB.put({
      TableName: ROLES_TABLE,
      Item: role
    }).promise();

    return createResponse(201, {
      success: true,
      message: 'Role created successfully',
      data: role
    });

  } catch (error) {
    console.error('CreateRole Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to create role',
      error: error.message
    });
  }
}

// 2. Get All Roles
async function getAllRoles(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const includeSystemRoles = queryParams.includeSystemRoles !== 'false';

    let params = {
      TableName: ROLES_TABLE,
      Limit: limit
    };

    // Filter system roles if needed
    if (!includeSystemRoles) {
      params.FilterExpression = 'isSystemRole = :false OR attribute_not_exists(isSystemRole)';
      params.ExpressionAttributeValues = {
        ':false': false
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
    console.error('GetAllRoles Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve roles',
      error: error.message
    });
  }
}

// 3. Get Role Details
async function getRole(event) {
  try {
    const roleId = event.pathParameters?.roleId;

    if (!roleId) {
      return createResponse(400, {
        success: false,
        message: 'roleId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: ROLES_TABLE,
      Key: { role_id: roleId }
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'Role not found'
      });
    }

    // Get count of users with this role
    const usersWithRole = await dynamoDB.scan({
      TableName: USERS_TABLE,
      FilterExpression: 'role_id = :roleId',
      ExpressionAttributeValues: {
        ':roleId': roleId
      },
      Select: 'COUNT'
    }).promise();

    const roleData = {
      ...result.Item,
      userCount: usersWithRole.Count || 0
    };

    return createResponse(200, {
      success: true,
      data: roleData
    });

  } catch (error) {
    console.error('GetRole Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve role',
      error: error.message
    });
  }
}

// 4. Get Role by Name
async function getRoleByName(event) {
  try {
    const roleName = event.pathParameters?.roleName;

    if (!roleName) {
      return createResponse(400, {
        success: false,
        message: 'roleName is required'
      });
    }

    const normalizedRoleName = roleName.toLowerCase().trim();

    const result = await dynamoDB.query({
      TableName: ROLES_TABLE,
      IndexName: 'roleName-index',
      KeyConditionExpression: 'role_name = :roleName',
      ExpressionAttributeValues: {
        ':roleName': normalizedRoleName
      }
    }).promise();

    if (!result.Items || result.Items.length === 0) {
      return createResponse(404, {
        success: false,
        message: 'Role not found'
      });
    }

    return createResponse(200, {
      success: true,
      data: result.Items[0]
    });

  } catch (error) {
    console.error('GetRoleByName Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve role',
      error: error.message
    });
  }
}

// 5. Update Role
async function updateRole(event) {
  try {
    const roleId = event.pathParameters?.roleId;

    if (!roleId) {
      return createResponse(400, {
        success: false,
        message: 'roleId is required'
      });
    }

    const updates = JSON.parse(event.body);

    // Check if role exists
    const existingRole = await dynamoDB.get({
      TableName: ROLES_TABLE,
      Key: { role_id: roleId }
    }).promise();

    if (!existingRole.Item) {
      return createResponse(404, {
        success: false,
        message: 'Role not found'
      });
    }

    // Prevent updating system roles' core properties
    if (existingRole.Item.isSystemRole && updates.roleName) {
      return createResponse(403, {
        success: false,
        message: 'Cannot change name of system roles'
      });
    }

    // If role name is being updated, check for duplicates
    if (updates.roleName && updates.roleName !== existingRole.Item.role_name) {
      const normalizedRoleName = updates.roleName.toLowerCase().trim();
      
      const duplicateCheck = await dynamoDB.query({
        TableName: ROLES_TABLE,
        IndexName: 'roleName-index',
        KeyConditionExpression: 'role_name = :roleName',
        ExpressionAttributeValues: {
          ':roleName': normalizedRoleName
        }
      }).promise();

      if (duplicateCheck.Items && duplicateCheck.Items.length > 0) {
        return createResponse(409, {
          success: false,
          message: 'Role with this name already exists'
        });
      }

      updates.roleName = normalizedRoleName;
    }

    // Fields that can be updated
    const allowedFields = ['roleName', 'permissions', 'description'];

    // Build update expression
    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = {
      ':updated_at': new Date().toISOString()
    };

    // Map roleName to role_name for DynamoDB
    if (updates.roleName !== undefined) {
      updateExpression += `, #role_name = :role_name`;
      expressionAttributeNames['#role_name'] = 'role_name';
      expressionAttributeValues[':role_name'] = updates.roleName;
    }

    if (updates.permissions !== undefined) {
      updateExpression += `, #permissions = :permissions`;
      expressionAttributeNames['#permissions'] = 'permissions';
      expressionAttributeValues[':permissions'] = updates.permissions;
    }

    if (updates.description !== undefined) {
      updateExpression += `, #description = :description`;
      expressionAttributeNames['#description'] = 'description';
      expressionAttributeValues[':description'] = updates.description;
    }

    // ✅ FIX: Check if any fields were actually updated
    if (Object.keys(expressionAttributeNames).length === 0) {
      return createResponse(400, {
        success: false,
        message: 'No valid fields to update'
      });
    }

    const params = {
      TableName: ROLES_TABLE,
      Key: { role_id: roleId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, {
      success: true,
      message: 'Role updated successfully',
      data: result.Attributes
    });

  } catch (error) {
    console.error('UpdateRole Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to update role',
      error: error.message
    });
  }
}


// 6. Delete Role
async function deleteRole(event) {
  try {
    const roleId = event.pathParameters?.roleId;

    if (!roleId) {
      return createResponse(400, {
        success: false,
        message: 'roleId is required'
      });
    }

    // Check if role exists
    const existingRole = await dynamoDB.get({
      TableName: ROLES_TABLE,
      Key: { role_id: roleId }
    }).promise();

    if (!existingRole.Item) {
      return createResponse(404, {
        success: false,
        message: 'Role not found'
      });
    }

    // Prevent deletion of system roles
    if (existingRole.Item.isSystemRole) {
      return createResponse(403, {
        success: false,
        message: 'Cannot delete system roles (admin, teacher, student, parent, system)'
      });
    }

    // Check if role is in use
    const usersWithRole = await dynamoDB.scan({
      TableName: USERS_TABLE,
      FilterExpression: 'role_id = :roleId',
      ExpressionAttributeValues: {
        ':roleId': roleId
      },
      Select: 'COUNT'
    }).promise();

    if (usersWithRole.Count > 0) {
      return createResponse(409, {
        success: false,
        message: `Cannot delete role. ${usersWithRole.Count} user(s) are currently assigned this role`,
        userCount: usersWithRole.Count
      });
    }

    // Delete the role
    await dynamoDB.delete({
      TableName: ROLES_TABLE,
      Key: { role_id: roleId }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Role deleted successfully'
    });

  } catch (error) {
    console.error('DeleteRole Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to delete role',
      error: error.message
    });
  }
}

// 7. Get Role Permissions
async function getRolePermissions(event) {
  try {
    const roleId = event.pathParameters?.roleId;

    if (!roleId) {
      return createResponse(400, {
        success: false,
        message: 'roleId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: ROLES_TABLE,
      Key: { role_id: roleId },
      ProjectionExpression: 'role_id, role_name, permissions'
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'Role not found'
      });
    }

    return createResponse(200, {
      success: true,
      data: result.Item
    });

  } catch (error) {
    console.error('GetRolePermissions Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve role permissions',
      error: error.message
    });
  }
}

// 8. Update Role Permissions
async function updateRolePermissions(event) {
  try {
    const roleId = event.pathParameters?.roleId;

    if (!roleId) {
      return createResponse(400, {
        success: false,
        message: 'roleId is required'
      });
    }

    const { permissions, action = 'replace' } = JSON.parse(event.body);

    if (!permissions || !Array.isArray(permissions)) {
      return createResponse(400, {
        success: false,
        message: 'permissions array is required'
      });
    }

    // Get current role
    const existingRole = await dynamoDB.get({
      TableName: ROLES_TABLE,
      Key: { role_id: roleId }
    }).promise();

    if (!existingRole.Item) {
      return createResponse(404, {
        success: false,
        message: 'Role not found'
      });
    }

    let updatedPermissions;

    switch (action) {
      case 'add':
        // Add new permissions to existing ones
        updatedPermissions = [...new Set([...existingRole.Item.permissions, ...permissions])];
        break;
      case 'remove':
        // Remove specified permissions
        updatedPermissions = existingRole.Item.permissions.filter(p => !permissions.includes(p));
        break;
      case 'replace':
      default:
        // Replace all permissions
        updatedPermissions = permissions;
        break;
    }

    const result = await dynamoDB.update({
      TableName: ROLES_TABLE,
      Key: { role_id: roleId },
      UpdateExpression: 'SET permissions = :permissions, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':permissions': updatedPermissions,
        ':updated_at': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Permissions updated successfully',
      data: result.Attributes
    });

  } catch (error) {
    console.error('UpdateRolePermissions Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to update permissions',
      error: error.message
    });
  }
}

// 9. Initialize Default Roles
async function initializeDefaultRoles(event) {
  try {
    const defaultRoles = ['admin', 'teacher', 'student', 'parent', 'system'];
    const createdRoles = [];
    const skippedRoles = [];

    for (const roleName of defaultRoles) {
      // Check if role already exists
      const existingRole = await dynamoDB.query({
        TableName: ROLES_TABLE,
        IndexName: 'roleName-index',
        KeyConditionExpression: 'role_name = :roleName',
        ExpressionAttributeValues: {
          ':roleName': roleName
        }
      }).promise();

      if (existingRole.Items && existingRole.Items.length > 0) {
        skippedRoles.push(roleName);
        continue;
      }

      const roleId = uuidv4();
      const timestamp = new Date().toISOString();

      const role = {
        role_id: roleId,
        role_name: roleName,
        permissions: DEFAULT_PERMISSIONS[roleName] || [],
        description: `System ${roleName} role`,
        isSystemRole: true,
        created_at: timestamp,
        updated_at: timestamp
      };

      await dynamoDB.put({
        TableName: ROLES_TABLE,
        Item: role
      }).promise();

      createdRoles.push(roleName);
    }

    return createResponse(200, {
      success: true,
      message: 'Default roles initialization completed',
      data: {
        created: createdRoles,
        skipped: skippedRoles
      }
    });

  } catch (error) {
    console.error('InitializeDefaultRoles Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to initialize default roles',
      error: error.message
    });
  }
}

// 10. Get Users by Role
async function getUsersByRole(event) {
  try {
    const roleId = event.pathParameters?.roleId;

    if (!roleId) {
      return createResponse(400, {
        success: false,
        message: 'roleId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    const params = {
      TableName: USERS_TABLE,
      FilterExpression: 'role_id = :roleId',
      ExpressionAttributeValues: {
        ':roleId': roleId
      },
      Limit: limit
    };

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

    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetUsersByRole Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve users',
      error: error.message
    });
  }
}

module.exports = {
  createRole: JWSauthenticate(createRole),
  getAllRoles: JWSauthenticate(getAllRoles),
  getRole: JWSauthenticate(getRole),
  getRoleByName: JWSauthenticate(getRoleByName),
  updateRole: JWSauthenticate(updateRole),
  deleteRole: JWSauthenticate(deleteRole),
  getRolePermissions: JWSauthenticate(getRolePermissions),
  updateRolePermissions: JWSauthenticate(updateRolePermissions),
  initializeDefaultRoles: JWSauthenticate(initializeDefaultRoles),
  getUsersByRole: JWSauthenticate(getUsersByRole)
};
