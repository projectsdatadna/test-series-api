const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const ERROR_BANK_TABLE = process.env.ERROR_BANK_TABLE || 'TestErrorBank';

const createResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
    "Access-Control-Allow-Credentials": true
  },
  body: JSON.stringify(body)
});

// 1. Log Error (wrong attempt)
async function logError(event) {
  try {
    if (!event || !event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      user_id,
      question_id,
      exam_id,
      retry_count = 0,
      last_attempt_score = 0,
      status = 'active'
    } = JSON.parse(event.body);

    if (!user_id || !question_id || !exam_id) {
      return createResponse(400, { success: false, message: 'user_id, question_id, and exam_id are required' });
    }

    const now = new Date().toISOString();
    const errorId = uuidv4();

    const item = {
      error_id: errorId,
      user_id,
      question_id,
      exam_id,
      retry_count,
      last_attempt_score,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: ERROR_BANK_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Error logged', data: item });
  } catch (error) {
    console.error('LogError Error:', error);
    return createResponse(500, { success: false, message: 'Failed to log error', error: error.message });
  }
}

// 2. Get User Error Bank
async function getUserErrorBank(event) {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    // Assumes GSI 'userId-index' on user_id
    const params = {
      TableName: ERROR_BANK_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetUserErrorBank Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve error bank', error: error.message });
  }
}

// 3. Get Error Details
async function getErrorDetails(event) {
  try {
    const errorId = event.pathParameters?.errorId;
    if (!errorId) return createResponse(400, { success: false, message: 'errorId is required' });

    const result = await dynamoDB.get({ TableName: ERROR_BANK_TABLE, Key: { error_id: errorId } }).promise();

    if (!result.Item) return createResponse(404, { success: false, message: 'Error record not found' });

    return createResponse(200, { success: true, data: result.Item });
  } catch (error) {
    console.error('GetErrorDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve error details', error: error.message });
  }
}

// 4. Update Retry Count
async function updateRetryCount(event) {
  try {
    const errorId = event.pathParameters?.errorId;
    if (!errorId) return createResponse(400, { success: false, message: 'errorId is required' });

    const { retry_count } = JSON.parse(event.body);
    if (typeof retry_count !== 'number') {
      return createResponse(400, { success: false, message: 'retry_count must be a number' });
    }

    const params = {
      TableName: ERROR_BANK_TABLE,
      Key: { error_id: errorId },
      UpdateExpression: 'SET retry_count = :retryCount, updated_at = :updatedAt',
      ExpressionAttributeValues: {
        ':retryCount': retry_count,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Retry count updated', data: result.Attributes });
  } catch (error) {
    console.error('UpdateRetryCount Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update retry count', error: error.message });
  }
}

// 5. Delete Error Record (soft delete)
async function deleteErrorRecord(event) {
  try {
    const errorId = event.pathParameters?.errorId;
    if (!errorId) return createResponse(400, { success: false, message: 'errorId is required' });

    const params = {
      TableName: ERROR_BANK_TABLE,
      Key: { error_id: errorId },
      UpdateExpression: 'SET #status = :status, updated_at = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updatedAt': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Error record marked inactive', data: result.Attributes });
  } catch (error) {
    console.error('DeleteErrorRecord Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete error record', error: error.message });
  }
}

// 6. Get Top Error Topics per User (Aggregation)
async function getTopErrorTopics(event) {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    // Scan user's active error records
    const params = {
      TableName: ERROR_BANK_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':userId': userId, ':status': 'active' }
    };

    const result = await dynamoDB.query(params).promise();
    const errors = result.Items;

    // Aggregate counts by subject_id (or other topic field)
    const topicCounts = {};
    errors.forEach(err => {
      const topic = err.subject_id || 'unknown';
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });

    // Sort topics by count descending
    const sortedTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count }));

    return createResponse(200, { success: true, data: sortedTopics });

  } catch (error) {
    console.error('GetTopErrorTopics Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve top error topics', error: error.message });
  }
}

module.exports = {
  logError,
  getUserErrorBank,
  getErrorDetails,
  updateRetryCount,
  deleteErrorRecord,
  getTopErrorTopics
};
