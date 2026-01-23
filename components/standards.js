const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const STANDARDS_TABLE = process.env.STANDARDS_TABLE || 'TestStandards';
const SUBJECTS_TABLE = process.env.SUBJECTS_TABLE || 'TestSubjects';

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

// 1. Create Standard
async function createStandard(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const { name, courseId, description = null, orderIndex = 0, status = 'active' } = JSON.parse(event.body);

    // Validate required fields
    if (!name) return createResponse(400, { success: false, message: 'name is required' });
    if (!courseId) return createResponse(400, { success: false, message: 'courseId is required' });

    const now = new Date().toISOString();
    const standardId = uuidv4();

    const item = {
      standard_id: standardId,
      name,
      course_id: courseId,
      description,
      order_index: orderIndex,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: STANDARDS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Standard created successfully', data: item });

  } catch (error) {
    console.error('CreateStandard Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create standard', error: error.message });
  }
}

// 2. Get All Standards (optionally filter by courseId)
async function getAllStandards(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const courseId = queryParams.courseId;

    let params = {
      TableName: STANDARDS_TABLE,
      Limit: limit
    };

    // If filtering by courseId, use Query on GSI with course_id (assumed GSI created)
    if (courseId) {
      params.IndexName = 'courseId-index'; // Ensure such GSI exists
      params.KeyConditionExpression = 'course_id = :courseId';
      params.ExpressionAttributeValues = { ':courseId': courseId };
    } else {
      // Scan if no GSI/filter
      // For limits, can use Scan but less efficient on large tables
      // Optionally add FilterExpression if needed
    }

    // Pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(queryParams.lastKey, 'base64').toString());
    }

    const result = courseId 
      ? await dynamoDB.query(params).promise()
      : await dynamoDB.scan(params).promise();

    const response = {
      success: true,
      data: result.Items,
      count: result.Items.length
    };

    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetAllStandards Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve standards', error: error.message });
  }
}

// 3. Get Standard Details
async function getStandardDetails(event) {
  try {
    const standardId = event.pathParameters?.standardId;

    if (!standardId) return createResponse(400, { success: false, message: 'standardId is required' });

    const result = await dynamoDB.get({
      TableName: STANDARDS_TABLE,
      Key: { standard_id: standardId }
    }).promise();

    if (!result.Item) return createResponse(404, { success: false, message: 'Standard not found' });

    return createResponse(200, { success: true, data: result.Item });

  } catch (error) {
    console.error('GetStandardDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve standard details', error: error.message });
  }
}

// 4. Update Standard
async function updateStandard(event) {
  try {
    const standardId = event.pathParameters?.standardId;

    if (!standardId) return createResponse(400, { success: false, message: 'standardId is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['name', 'description', 'order_index', 'status'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = (key === 'status' && updates[key]) ? updates[key].toLowerCase() : updates[key];
      }
    });

    const params = {
      TableName: STANDARDS_TABLE,
      Key: { standard_id: standardId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Standard updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateStandard Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update standard', error: error.message });
  }
}

// 5. Delete Standard (Soft delete)
async function deleteStandard(event) {
  try {
    const standardId = event.pathParameters?.standardId;
    if (!standardId) return createResponse(400, { success: false, message: 'standardId is required' });

    // Soft delete by setting status to inactive or archived
    const params = {
      TableName: STANDARDS_TABLE,
      Key: { standard_id: standardId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'archived', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Standard deleted (archived) successfully', data: result.Attributes });

  } catch (error) {
    console.error('DeleteStandard Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete standard', error: error.message });
  }
}

// 6. Get Standard Subjects
async function getStandardSubjects(event) {
  try {
    const standardId = event.pathParameters?.standardId;

    if (!standardId) return createResponse(400, { success: false, message: 'standardId is required' });

    // Assuming a GSI 'standardId-index' exists on Subjects table with partition key 'standard_id'
    const params = {
      TableName: SUBJECTS_TABLE,
      IndexName: 'standardId-index',
      KeyConditionExpression: 'standard_id = :standardId',
      ExpressionAttributeValues: { ':standardId': standardId },
      Limit: 50
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items });

  } catch (error) {
    console.error('GetStandardSubjects Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve subjects for standard', error: error.message });
  }
}

module.exports = {
  createStandard,
  getAllStandards,
  getStandardDetails,
  updateStandard,
  deleteStandard,
  getStandardSubjects
};
