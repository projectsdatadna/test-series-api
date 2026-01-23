const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const COURSE_BUNDLES_TABLE = process.env.COURSE_BUNDLES_TABLE || 'TestCourseBundles';
const COURSES_TABLE = process.env.COURSES_TABLE || 'TestCourses';

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

// 1. Create Bundle
async function createBundle(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const {
      name,
      description = null,
      courseIds = [],
      standardId = null,
      maxSelectableCourses = 0,
      createdBy,
      status = 'active',
      subjectId = null,
      materialId = null,
      chapterId = null,
      sectionId = null
    } = JSON.parse(event.body);

    if (!name) return createResponse(400, { success: false, message: 'name is required' });
    if (!createdBy) return createResponse(400, { success: false, message: 'createdBy is required' });

    const now = new Date().toISOString();
    const bundleId = uuidv4();

    const item = {
      bundle_id: bundleId,
      name,
      description,
      course_ids: courseIds,
      standard_id: standardId,
      maxSelectableCourses,
      created_by: createdBy,
      status: status.toLowerCase(),
      subject_id: subjectId,
      material_id: materialId,
      chapter_id: chapterId,
      section_id: sectionId,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: COURSE_BUNDLES_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Bundle created successfully', data: item });

  } catch (error) {
    console.error('CreateBundle Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create bundle', error: error.message });
  }
}

// 2. Get All Bundles
async function getAllBundles(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const status = queryParams.status; // Filter by status if provided

    let params = {
      TableName: COURSE_BUNDLES_TABLE,
      Limit: limit
    };

    // Add FilterExpression if filtering by status
    if (status) {
      params.FilterExpression = '#status = :status';
      params.ExpressionAttributeNames = { '#status': 'status' };
      params.ExpressionAttributeValues = { ':status': status.toLowerCase() };
    }

    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(queryParams.lastKey, 'base64').toString());
    }

    const result = await dynamoDB.scan(params).promise();

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
    console.error('GetAllBundles Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve bundles', error: error.message });
  }
}

// 3. Get Bundle Details (with included courses)
async function getBundleDetails(event) {
  try {
    const bundleId = event.pathParameters?.bundleId;
    if (!bundleId) return createResponse(400, { success: false, message: 'bundleId is required' });

    const bundleResult = await dynamoDB.get({
      TableName: COURSE_BUNDLES_TABLE,
      Key: { bundle_id: bundleId }
    }).promise();

    if (!bundleResult.Item) return createResponse(404, { success: false, message: 'Bundle not found' });

    const bundle = bundleResult.Item;

    // Fetch course details for all course_ids
    let courses = [];
    if (bundle.course_ids && bundle.course_ids.length > 0) {
      const coursePromises = bundle.course_ids.map(courseId =>
        dynamoDB.get({ TableName: COURSES_TABLE, Key: { course_id: courseId }}).promise()
      );
      const courseResults = await Promise.all(coursePromises);
      courses = courseResults.filter(r => r.Item).map(r => r.Item);
    }

    return createResponse(200, { success: true, data: { ...bundle, courses } });

  } catch (error) {
    console.error('GetBundleDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve bundle details', error: error.message });
  }
}

// 4. Update Bundle
async function updateBundle(event) {
  try {
    const bundleId = event.pathParameters?.bundleId;
    if (!bundleId) return createResponse(400, { success: false, message: 'bundleId is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['name', 'description', 'course_ids', 'standard_id', 'maxSelectableCourses', 'status', 'subject_id', 'material_id', 'chapter_id', 'section_id'];

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
      TableName: COURSE_BUNDLES_TABLE,
      Key: { bundle_id: bundleId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Bundle updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateBundle Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update bundle', error: error.message });
  }
}

// 5. Delete (Deactivate) Bundle
async function deleteBundle(event) {
  try {
    const bundleId = event.pathParameters?.bundleId;
    if (!bundleId) return createResponse(400, { success: false, message: 'bundleId is required' });

    // Soft delete by setting status inactive
    const params = {
      TableName: COURSE_BUNDLES_TABLE,
      Key: { bundle_id: bundleId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Bundle deactivated successfully', data: result.Attributes });

  } catch (error) {
    console.error('DeleteBundle Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete bundle', error: error.message });
  }
}

// 6. Add Courses to Bundle
async function addCoursesToBundle(event) {
  try {
    const bundleId = event.pathParameters?.bundleId;
    if (!bundleId) return createResponse(400, { success: false, message: 'bundleId is required' });

    const { courseIds } = JSON.parse(event.body);
    if (!courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
      return createResponse(400, { success: false, message: 'courseIds array is required' });
    }

    // Get existing bundle
    const bundleResult = await dynamoDB.get({ TableName: COURSE_BUNDLES_TABLE, Key: { bundle_id: bundleId } }).promise();
    if (!bundleResult.Item) return createResponse(404, { success: false, message: 'Bundle not found' });

    // Merge course IDs uniquely
    const existingCourses = bundleResult.Item.course_ids || [];
    const newCourseIds = Array.from(new Set([...existingCourses, ...courseIds]));

    // Update bundle
    const params = {
      TableName: COURSE_BUNDLES_TABLE,
      Key: { bundle_id: bundleId },
      UpdateExpression: 'SET course_ids = :courseIds, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':courseIds': newCourseIds,
        ':updated_at': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Courses added to bundle successfully', data: result.Attributes });

  } catch (error) {
    console.error('AddCoursesToBundle Error:', error);
    return createResponse(500, { success: false, message: 'Failed to add courses to bundle', error: error.message });
  }
}

module.exports = {
  createBundle,
  getAllBundles,
  getBundleDetails,
  updateBundle,
  deleteBundle,
  addCoursesToBundle
};
