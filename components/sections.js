const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const SECTIONS_TABLE = process.env.SECTIONS_TABLE || 'TestSections';
const MATERIALS_TABLE = process.env.MATERIALS_TABLE || 'TestLearningMaterials';

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

// 1. Create Section
async function createSection(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const {
      name,
      chapterId,
      description = null,
      orderIndex = 0,
      duration = null,
      status = 'active',
      subjectId = null,
      materialId = null,
      courseId = null,
      standardId = null
    } = JSON.parse(event.body);

    if (!name) return createResponse(400, { success: false, message: 'name is required' });
    if (!chapterId) return createResponse(400, { success: false, message: 'chapterId is required' });

    const now = new Date().toISOString();
    const sectionId = uuidv4();

    const item = {
      section_id: sectionId,
      name,
      chapter_id: chapterId,
      description,
      order_index: orderIndex,
      duration,
      status: status.toLowerCase(),
      subject_id: subjectId,
      material_id: materialId,
      course_id: courseId,
      standard_id: standardId,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: SECTIONS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Section created successfully', data: item });

  } catch (error) {
    console.error('CreateSection Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create section', error: error.message });
  }
}

// 2. Get All Sections (optional filtering by chapterId, subjectId)
async function getAllSections(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const chapterId = queryParams.chapterId;
    const subjectId = queryParams.subjectId;

    let params = {
      TableName: SECTIONS_TABLE,
      Limit: limit
    };

    if (chapterId) {
      params.IndexName = 'chapterId-index';  // Ensure GSI exists
      params.KeyConditionExpression = 'chapter_id = :chapterId';
      params.ExpressionAttributeValues = { ':chapterId': chapterId };
    } else if (subjectId) {
      params.IndexName = 'subjectId-index';  // Ensure GSI exists
      params.KeyConditionExpression = 'subject_id = :subjectId';
      params.ExpressionAttributeValues = { ':subjectId': subjectId };
    }

    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(queryParams.lastKey, 'base64').toString());
    }

    const result = (params.KeyConditionExpression)
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
    console.error('GetAllSections Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve sections', error: error.message });
  }
}

// 3. Get Section Details (with materials)
async function getSectionDetails(event) {
  try {
    const sectionId = event.pathParameters?.sectionId;
    if (!sectionId) return createResponse(400, { success: false, message: 'sectionId is required' });

    const sectionResult = await dynamoDB.get({
      TableName: SECTIONS_TABLE,
      Key: { section_id: sectionId }
    }).promise();

    if (!sectionResult.Item) return createResponse(404, { success: false, message: 'Section not found' });

    // Get linked materials if material_id exists
    let materials = [];
    if (sectionResult.Item.material_id) {
      const materialResult = await dynamoDB.get({
        TableName: MATERIALS_TABLE,
        Key: { material_id: sectionResult.Item.material_id }
      }).promise();
      if (materialResult.Item) materials.push(materialResult.Item);
    }

    const section = {
      ...sectionResult.Item,
      materials
    };

    return createResponse(200, { success: true, data: section });

  } catch (error) {
    console.error('GetSectionDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve section details', error: error.message });
  }
}

// 4. Update Section
async function updateSection(event) {
  try {
    const sectionId = event.pathParameters?.sectionId;
    if (!sectionId) return createResponse(400, { success: false, message: 'sectionId is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['name', 'description', 'order_index', 'duration', 'status', 'subject_id', 'material_id', 'course_id', 'standard_id', 'chapter_id'];

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
      TableName: SECTIONS_TABLE,
      Key: { section_id: sectionId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Section updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateSection Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update section', error: error.message });
  }
}

// 5. Delete Section (soft delete)
async function deleteSection(event) {
  try {
    const sectionId = event.pathParameters?.sectionId;
    if (!sectionId) return createResponse(400, { success: false, message: 'sectionId is required' });

    const params = {
      TableName: SECTIONS_TABLE,
      Key: { section_id: sectionId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Section marked inactive', data: result.Attributes });

  } catch (error) {
    console.error('DeleteSection Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete section', error: error.message });
  }
}

// 6. Get Sections by Chapter
async function getSectionsByChapter(event) {
  try {
    const chapterId = event.pathParameters?.chapterId;
    if (!chapterId) return createResponse(400, { success: false, message: 'chapterId is required' });

    const params = {
      TableName: SECTIONS_TABLE,
      IndexName: 'chapterId-index',
      KeyConditionExpression: 'chapter_id = :chapterId',
      ExpressionAttributeValues: { ':chapterId': chapterId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items });

  } catch (error) {
    console.error('GetSectionsByChapter Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve sections by chapter', error: error.message });
  }
}

module.exports = {
  createSection,
  getAllSections,
  getSectionDetails,
  updateSection,
  deleteSection,
  getSectionsByChapter
};
