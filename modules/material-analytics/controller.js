const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const MATERIAL_ANALYTICS_TABLE = process.env.MATERIAL_ANALYTICS_TABLE || 'TestMaterialAnalytics';

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

// 1. Record Analytics (Create or Update)
async function recordAnalytics(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const input = JSON.parse(event.body);

    const {
      total_views,
      avg_rating,
      completion_rate,
      course_id = null,
      section_id = null,
      standard_id = null,
      subject_id = null,
      chapter_id = null,
      status = 'active'
    } = input;

    if (typeof total_views !== 'number' || typeof avg_rating !== 'number' || typeof completion_rate !== 'number') {
      return createResponse(400, { success: false, message: 'total_views, avg_rating, completion_rate must be numbers' });
    }

    const now = new Date().toISOString();

    // Check if analytics record exists
    const existing = await dynamoDB.query({
      TableName: MATERIAL_ANALYTICS_TABLE,
      IndexName: 'materialId-index',
      KeyConditionExpression: 'material_id = :materialId',
      ExpressionAttributeValues: { ':materialId': materialId }
    }).promise();

    let analyticsId;

    if (existing.Items && existing.Items.length > 0) {
      analyticsId = existing.Items[0].analytics_id;
      // Update existing record
      const params = {
        TableName: MATERIAL_ANALYTICS_TABLE,
        Key: { analytics_id: analyticsId },
        UpdateExpression: `SET total_views = :total_views, avg_rating = :avg_rating, completion_rate = :completion_rate,
          course_id = :course_id, section_id = :section_id, standard_id = :standard_id, subject_id = :subject_id,
          chapter_id = :chapter_id, status = :status, updated_at = :updated_at`,
        ExpressionAttributeValues: {
          ':total_views': total_views,
          ':avg_rating': avg_rating,
          ':completion_rate': completion_rate,
          ':course_id': course_id,
          ':section_id': section_id,
          ':standard_id': standard_id,
          ':subject_id': subject_id,
          ':chapter_id': chapter_id,
          ':status': status.toLowerCase(),
          ':updated_at': now
        },
        ReturnValues: 'ALL_NEW'
      };

      const updateResult = await dynamoDB.update(params).promise();

      return createResponse(200, { success: true, message: 'Analytics updated', data: updateResult.Attributes });
    } else {
      // Create new record
      analyticsId = uuidv4();

      const item = {
        analytics_id: analyticsId,
        material_id: materialId,
        total_views,
        avg_rating,
        completion_rate,
        course_id,
        section_id,
        standard_id,
        subject_id,
        chapter_id,
        status: status.toLowerCase(),
        created_at: now,
        updated_at: now
      };

      await dynamoDB.put({ TableName: MATERIAL_ANALYTICS_TABLE, Item: item }).promise();

      return createResponse(201, { success: true, message: 'Analytics recorded', data: item });
    }

  } catch (error) {
    console.error('RecordAnalytics Error:', error);
    return createResponse(500, { success: false, message: 'Failed to record analytics', error: error.message });
  }
}

// 2. Get Analytics for Material
async function getAnalyticsForMaterial(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });

    const result = await dynamoDB.query({
      TableName: MATERIAL_ANALYTICS_TABLE,
      IndexName: 'materialId-index',
      KeyConditionExpression: 'material_id = :materialId',
      ExpressionAttributeValues: { ':materialId': materialId },
      Limit: 1
    }).promise();

    if (!result.Items || result.Items.length === 0)
      return createResponse(404, { success: false, message: 'Analytics not found' });

    return createResponse(200, { success: true, data: result.Items[0] });

  } catch (error) {
    console.error('GetAnalyticsForMaterial Error:', error);
    return createResponse(500, { success: false, message: 'Failed to fetch analytics', error: error.message });
  }
}

// 3. Update Analytics
async function updateAnalytics(event) {
  try {
    const analyticsId = event.pathParameters?.analyticsId;
    if (!analyticsId) return createResponse(400, { success: false, message: 'analyticsId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);
    const allowedFields = ['total_views', 'avg_rating', 'completion_rate', 'status'];

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

    if (Object.keys(expressionAttributeNames).length === 0) {
      return createResponse(400, { success: false, message: 'No valid fields to update' });
    }

    const params = {
      TableName: MATERIAL_ANALYTICS_TABLE,
      Key: { analytics_id: analyticsId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Analytics updated', data: result.Attributes });
  } catch (error) {
    console.error('UpdateAnalytics Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update analytics', error: error.message });
  }
}

// 4. Get All Analytics
async function getAllAnalytics(event) {
  try {
    const params = { TableName: MATERIAL_ANALYTICS_TABLE };

    const result = await dynamoDB.scan(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetAllAnalytics Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve analytics', error: error.message });
  }
}

// 5. Get Analytics by Course
async function getAnalyticsByCourse(event) {
  try {
    const courseId = event.pathParameters?.courseId;
    if (!courseId) return createResponse(400, { success: false, message: 'courseId is required' });

    // Assumes GSI 'courseId-index' with partition key course_id
    const params = {
      TableName: MATERIAL_ANALYTICS_TABLE,
      IndexName: 'courseId-index',
      KeyConditionExpression: 'course_id = :courseId',
      ExpressionAttributeValues: { ':courseId': courseId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetAnalyticsByCourse Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get analytics by course', error: error.message });
  }
}

// 6. Get Top Viewed Materials
async function getTopViewedMaterials(event) {
  try {
    const params = {
      TableName: MATERIAL_ANALYTICS_TABLE,
      // DynamoDB does not support order by; requires scan + client-side sort or use ElasticSearch
      // Here, get all active items and sort in memory:
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':active': 'active' }
    };

    const result = await dynamoDB.scan(params).promise();

    const sorted = result.Items.sort((a, b) => (b.total_views || 0) - (a.total_views || 0)).slice(0, 10);

    return createResponse(200, { success: true, data: sorted });
  } catch (error) {
    console.error('GetTopViewedMaterials Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get top viewed materials', error: error.message });
  }
}

// 7. Get High Rated Materials
async function getTopRatedMaterials(event) {
  try {
    const params = {
      TableName: MATERIAL_ANALYTICS_TABLE,
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':active': 'active' }
    };

    const result = await dynamoDB.scan(params).promise();

    const sorted = result.Items.sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0)).slice(0, 10);

    return createResponse(200, { success: true, data: sorted });
  } catch (error) {
    console.error('GetTopRatedMaterials Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get top rated materials', error: error.message });
  }
}

module.exports = {
  recordAnalytics,
  getAnalyticsForMaterial,
  updateAnalytics,
  getAllAnalytics,
  getAnalyticsByCourse,
  getTopViewedMaterials,
  getTopRatedMaterials
};
