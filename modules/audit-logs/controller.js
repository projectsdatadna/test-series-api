require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const { JWSauthenticate } = require("../../components/JWTtoken");
const { getUser } = require('../users/controller');

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || 'TestAuditLogs';
const USERS_TABLE = process.env.USERS_TABLE || 'Users';

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

// Get user agent from event
const getUserAgent = (event) => {
  if (event.headers) {
    return event.headers['User-Agent'] || 
           event.headers['user-agent'] || 
           'Unknown';
  }
  return 'Unknown';
};

// Valid modules
const VALID_MODULES = [
  'User', 'Role', 'Profile', 'Session', 'Course', 'Subject', 
  'Category', 'Material', 'Quiz', 'Assignment', 'Grade', 
  'Enrollment', 'Authentication', 'System', 'Settings'
];

// Valid actions
const VALID_ACTIONS = [
  'create', 'read', 'update', 'delete', 'login', 'logout',
  'upload', 'download', 'assign', 'revoke', 'approve', 'reject',
  'submit', 'grade', 'enroll', 'unenroll', 'activate', 'deactivate',
  'reset_password', 'change_password', 'verify', 'export', 'import'
];

// 1. Log Action (Internal - used by other services)
async function logAction(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const {
      userId,
      action,
      module,
      details,
      resourceId,
      resourceType,
      status = 'success',
      errorMessage
    } = JSON.parse(event.body);

    // Validation
    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    if (!action) {
      return createResponse(400, {
        success: false,
        message: 'action is required'
      });
    }

    if (!module) {
      return createResponse(400, {
        success: false,
        message: 'module is required'
      });
    }

    // Validate module
    if (!VALID_MODULES.includes(module)) {
      return createResponse(400, {
        success: false,
        message: `Invalid module. Must be one of: ${VALID_MODULES.join(', ')}`
      });
    }

    // Extract metadata
    const ipAddress = getIpAddress(event);
    const userAgent = getUserAgent(event);

    const logId = uuidv4();
    const timestamp = new Date().toISOString();

    const auditLog = {
      log_id: logId,
      user_id: userId,
      action: action.toLowerCase(),
      module: module,
      details: details || {},
      resource_id: resourceId || null,
      resource_type: resourceType || null,
      status: status,
      error_message: errorMessage || null,
      ip_address: ipAddress,
      user_agent: userAgent,
      timestamp: timestamp,
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days TTL
    };

    await dynamoDB.put({
      TableName: AUDIT_LOGS_TABLE,
      Item: auditLog
    }).promise();

    return createResponse(201, {
      success: true,
      message: 'Audit log created successfully',
      data: {
        logId: logId,
        timestamp: timestamp
      }
    });

  } catch (error) {
    console.error('LogAction Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to create audit log',
      error: error.message
    });
  }
}

// 2. Get All Logs (Admin Only)
async function getAllLogs(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 100;
    const module = queryParams.module;
    const action = queryParams.action;
    const status = queryParams.status;
    const startDate = queryParams.startDate;
    const endDate = queryParams.endDate;

    let params = {
      TableName: AUDIT_LOGS_TABLE,
      Limit: limit,
      ScanIndexForward: false // Most recent first
    };

    // Build filter expression
    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (module) {
      filterExpressions.push('#module = :module');
      expressionAttributeNames['#module'] = 'module';
      expressionAttributeValues[':module'] = module;
    }

    if (action) {
      filterExpressions.push('#action = :action');
      expressionAttributeNames['#action'] = 'action';
      expressionAttributeValues[':action'] = action.toLowerCase();
    }

    if (status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = status;
    }

    if (startDate) {
      filterExpressions.push('#timestamp >= :startDate');
      expressionAttributeNames['#timestamp'] = 'timestamp';
      expressionAttributeValues[':startDate'] = startDate;
    }

    if (endDate) {
      filterExpressions.push('#timestamp <= :endDate');
      expressionAttributeNames['#timestamp'] = 'timestamp';
      expressionAttributeValues[':endDate'] = endDate;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.scan(params).promise();

    // Sort by timestamp (most recent first)
    const sortedLogs = result.Items.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    const response = {
      success: true,
      data: sortedLogs,
      count: sortedLogs.length
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetAllLogs Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve audit logs',
      error: error.message
    });
  }
}

async function getUserLogs(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 100;
    const action = queryParams.action;
    const module = queryParams.module;
    const startDate = queryParams.startDate;
    const endDate = queryParams.endDate;

    let params = {
      TableName: AUDIT_LOGS_TABLE,
      IndexName: 'userId-timestamp-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Limit: limit,
      ScanIndexForward: false // Most recent first
    };

    // ✅ FIX: Only add ExpressionAttributeNames if needed
    const expressionAttributeNames = {};
    const filterExpressions = [];

    // Add timestamp range if provided
    if (startDate && endDate) {
      params.KeyConditionExpression += ' AND #timestamp BETWEEN :startDate AND :endDate';
      expressionAttributeNames['#timestamp'] = 'timestamp';
      params.ExpressionAttributeValues[':startDate'] = startDate;
      params.ExpressionAttributeValues[':endDate'] = endDate;
    } else if (startDate) {
      params.KeyConditionExpression += ' AND #timestamp >= :startDate';
      expressionAttributeNames['#timestamp'] = 'timestamp';
      params.ExpressionAttributeValues[':startDate'] = startDate;
    }

    // Add filters
    if (action) {
      filterExpressions.push('#action = :action');
      expressionAttributeNames['#action'] = 'action';
      params.ExpressionAttributeValues[':action'] = action.toLowerCase();
    }

    if (module) {
      filterExpressions.push('#module = :module');
      expressionAttributeNames['#module'] = 'module';
      params.ExpressionAttributeValues[':module'] = module;
    }

    // ✅ FIX: Only set ExpressionAttributeNames if it has values
    if (Object.keys(expressionAttributeNames).length > 0) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    // ✅ FIX: Only set FilterExpression if filters exist
    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    // Get user details
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    const response = {
      success: true,
      data: {
        user: userResult.Item ? {
          userId: userResult.Item.user_id,
          email: userResult.Item.email,
          fullName: userResult.Item.full_name,
          roleId: userResult.Item.role_id
        } : null,
        logs: result.Items,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetUserLogs Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve user logs',
      error: error.message
    });
  }
}

// 4. Filter Logs by Module
async function getLogsByModule(event) {
  try {
    const moduleName = event.pathParameters?.moduleName;

    if (!moduleName) {
      return createResponse(400, {
        success: false,
        message: 'moduleName is required'
      });
    }

    // Validate module
    if (!VALID_MODULES.includes(moduleName)) {
      return createResponse(400, {
        success: false,
        message: `Invalid module. Must be one of: ${VALID_MODULES.join(', ')}`
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 100;
    const action = queryParams.action;
    const userId = queryParams.userId;
    const startDate = queryParams.startDate;
    const endDate = queryParams.endDate;

    let params = {
      TableName: AUDIT_LOGS_TABLE,
      IndexName: 'module-timestamp-index',
      KeyConditionExpression: '#module = :module',
      ExpressionAttributeNames: {
        '#module': 'module'
      },
      ExpressionAttributeValues: {
        ':module': moduleName
      },
      Limit: limit,
      ScanIndexForward: false // Most recent first
    };

    // Add timestamp range if provided
    if (startDate && endDate) {
      params.KeyConditionExpression += ' AND #timestamp BETWEEN :startDate AND :endDate';
      params.ExpressionAttributeNames['#timestamp'] = 'timestamp';
      params.ExpressionAttributeValues[':startDate'] = startDate;
      params.ExpressionAttributeValues[':endDate'] = endDate;
    } else if (startDate) {
      params.KeyConditionExpression += ' AND #timestamp >= :startDate';
      params.ExpressionAttributeNames['#timestamp'] = 'timestamp';
      params.ExpressionAttributeValues[':startDate'] = startDate;
    }

    // Add filters
    const filterExpressions = [];

    if (action) {
      filterExpressions.push('#action = :action');
      params.ExpressionAttributeNames['#action'] = 'action';
      params.ExpressionAttributeValues[':action'] = action.toLowerCase();
    }

    if (userId) {
      filterExpressions.push('user_id = :userId');
      params.ExpressionAttributeValues[':userId'] = userId;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    const response = {
      success: true,
      data: {
        module: moduleName,
        logs: result.Items,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetLogsByModule Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve module logs',
      error: error.message
    });
  }
}

// 5. Get Log Details
async function getLogDetails(event) {
  try {
    const logId = event.pathParameters?.logId;

    if (!logId) {
      return createResponse(400, {
        success: false,
        message: 'logId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: AUDIT_LOGS_TABLE,
      Key: { log_id: logId }
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'Audit log not found'
      });
    }

    // Get user details
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: result.Item.user_id }
    }).promise();

    const logData = {
      ...result.Item,
      user: userResult.Item ? {
        userId: userResult.Item.user_id,
        email: userResult.Item.email,
        fullName: userResult.Item.full_name,
        roleId: userResult.Item.role_id
      } : null
    };

    return createResponse(200, {
      success: true,
      data: logData
    });

  } catch (error) {
    console.error('GetLogDetails Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve log details',
      error: error.message
    });
  }
}

// 6. Get Logs by Action
async function getLogsByAction(event) {
  try {
    const action = event.pathParameters?.action;

    if (!action) {
      return createResponse(400, {
        success: false,
        message: 'action is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 100;
    const module = queryParams.module;
    const userId = queryParams.userId;

    let params = {
      TableName: AUDIT_LOGS_TABLE,
      FilterExpression: '#action = :action',
      ExpressionAttributeNames: {
        '#action': 'action'
      },
      ExpressionAttributeValues: {
        ':action': action.toLowerCase()
      },
      Limit: limit
    };

    // Add additional filters
    if (module) {
      params.FilterExpression += ' AND #module = :module';
      params.ExpressionAttributeNames['#module'] = 'module';
      params.ExpressionAttributeValues[':module'] = module;
    }

    if (userId) {
      params.FilterExpression += ' AND user_id = :userId';
      params.ExpressionAttributeValues[':userId'] = userId;
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.scan(params).promise();

    // Sort by timestamp (most recent first)
    const sortedLogs = result.Items.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    const response = {
      success: true,
      data: {
        action: action,
        logs: sortedLogs,
        count: sortedLogs.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetLogsByAction Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve logs by action',
      error: error.message
    });
  }
}

// 7. Get Audit Statistics
async function getAuditStatistics(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const startDate = queryParams.startDate;
    const endDate = queryParams.endDate || new Date().toISOString();
    const userId = queryParams.userId;

    let params = {
      TableName: AUDIT_LOGS_TABLE
    };

    // Build filter expression for date range
    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (startDate) {
      filterExpressions.push('#timestamp BETWEEN :startDate AND :endDate');
      expressionAttributeNames['#timestamp'] = 'timestamp';
      expressionAttributeValues[':startDate'] = startDate;
      expressionAttributeValues[':endDate'] = endDate;
    }

    if (userId) {
      filterExpressions.push('user_id = :userId');
      expressionAttributeValues[':userId'] = userId;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    const result = await dynamoDB.scan(params).promise();
    const logs = result.Items;

    // Calculate statistics
    const statistics = {
      totalLogs: logs.length,
      byModule: {},
      byAction: {},
      byStatus: {
        success: 0,
        failure: 0,
        warning: 0
      },
      byDate: {},
      topUsers: {},
      recentActivity: logs
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10)
    };

    // Aggregate data
    logs.forEach(log => {
      // By Module
      statistics.byModule[log.module] = (statistics.byModule[log.module] || 0) + 1;

      // By Action
      statistics.byAction[log.action] = (statistics.byAction[log.action] || 0) + 1;

      // By Status
      if (log.status) {
        statistics.byStatus[log.status] = (statistics.byStatus[log.status] || 0) + 1;
      }

      // By Date
      const date = log.timestamp.split('T')[0];
      statistics.byDate[date] = (statistics.byDate[date] || 0) + 1;

      // Top Users
      statistics.topUsers[log.user_id] = (statistics.topUsers[log.user_id] || 0) + 1;
    });

    // Convert topUsers to sorted array
    statistics.topUsers = Object.entries(statistics.topUsers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, count]) => ({ userId, count }));

    return createResponse(200, {
      success: true,
      data: statistics
    });

  } catch (error) {
    console.error('GetAuditStatistics Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve audit statistics',
      error: error.message
    });
  }
}

// 8. Delete Old Logs (Admin - Cleanup)
async function deleteOldLogs(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const daysOld = parseInt(queryParams.daysOld) || 90;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffTimestamp = cutoffDate.toISOString();

    // Scan for old logs
    const scanParams = {
      TableName: AUDIT_LOGS_TABLE,
      FilterExpression: '#timestamp < :cutoffDate',
      ExpressionAttributeNames: {
        '#timestamp': 'timestamp'
      },
      ExpressionAttributeValues: {
        ':cutoffDate': cutoffTimestamp
      }
    };

    const result = await dynamoDB.scan(scanParams).promise();
    let deletedCount = 0;

    // Delete in batches of 25 (DynamoDB limit)
    const batchSize = 25;
    for (let i = 0; i < result.Items.length; i += batchSize) {
      const batch = result.Items.slice(i, i + batchSize);
      
      const deleteRequests = batch.map(item => ({
        DeleteRequest: {
          Key: { log_id: item.log_id }
        }
      }));

      await dynamoDB.batchWrite({
        RequestItems: {
          [AUDIT_LOGS_TABLE]: deleteRequests
        }
      }).promise();

      deletedCount += deleteRequests.length;
    }

    return createResponse(200, {
      success: true,
      message: `Deleted ${deletedCount} logs older than ${daysOld} days`,
      data: {
        deletedCount: deletedCount,
        cutoffDate: cutoffTimestamp
      }
    });

  } catch (error) {
    console.error('DeleteOldLogs Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to delete old logs',
      error: error.message
    });
  }
}

// 9. Export Logs (CSV format)
async function exportLogs(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const format = queryParams.format || 'json'; // json or csv
    const module = queryParams.module;
    const userId = queryParams.userId;
    const startDate = queryParams.startDate;
    const endDate = queryParams.endDate;

    let params = {
      TableName: AUDIT_LOGS_TABLE
    };

    // Build filter
    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (module) {
      filterExpressions.push('#module = :module');
      expressionAttributeNames['#module'] = 'module';
      expressionAttributeValues[':module'] = module;
    }

    if (userId) {
      filterExpressions.push('user_id = :userId');
      expressionAttributeValues[':userId'] = userId;
    }

    if (startDate && endDate) {
      filterExpressions.push('#timestamp BETWEEN :startDate AND :endDate');
      expressionAttributeNames['#timestamp'] = 'timestamp';
      expressionAttributeValues[':startDate'] = startDate;
      expressionAttributeValues[':endDate'] = endDate;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    const result = await dynamoDB.scan(params).promise();
    const logs = result.Items.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    if (format === 'csv') {
      // Convert to CSV
      const csvHeaders = 'Log ID,User ID,Action,Module,Status,IP Address,Timestamp\n';
      const csvRows = logs.map(log => 
        `${log.log_id},${log.user_id},${log.action},${log.module},${log.status},${log.ip_address},${log.timestamp}`
      ).join('\n');
      
      const csv = csvHeaders + csvRows;

      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="audit-logs-${Date.now()}.csv"`
        },
        body: csv
      };
    }

    // Return JSON
    return createResponse(200, {
      success: true,
      data: {
        logs: logs,
        count: logs.length,
        exportedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('ExportLogs Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to export logs',
      error: error.message
    });
  }
}

module.exports = {
  logAction: JWSauthenticate(logAction),
  getAllLogs: JWSauthenticate(getAllLogs),
  getUserLogs: JWSauthenticate(getUserLogs),
  getLogsByModule: JWSauthenticate(getLogsByModule),
  getLogDetails: JWSauthenticate(getLogDetails),
  getLogsByAction: JWSauthenticate(getLogsByAction),
  getAuditStatistics: JWSauthenticate(getAuditStatistics),
  deleteOldLogs: JWSauthenticate(deleteOldLogs),
  exportLogs: JWSauthenticate(exportLogs),
  VALID_MODULES,
  VALID_ACTIONS
};
