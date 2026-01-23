const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const LOCALIZED_CONTENT_TABLE = process.env.LOCALIZED_CONTENT_TABLE || 'TestLocalizedContent';

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

// 1. Create Localized Version
async function createLocalizedContent(event) {
  try {
    if (!event || !event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      material_id,
      language,
      translated_text,
      audio_path = null,
      course_id = null,
      section_id = null,
      standard_id = null,
      subject_id = null,
      chapter_id = null,
      status = 'active'
    } = JSON.parse(event.body);

    if (!material_id) return createResponse(400, { success: false, message: 'material_id is required' });
    if (!language) return createResponse(400, { success: false, message: 'language is required' });
    if (!translated_text) return createResponse(400, { success: false, message: 'translated_text is required' });

    const now = new Date().toISOString();
    const localizedId = uuidv4();

    const item = {
      localized_id: localizedId,
      material_id,
      course_id,
      section_id,
      standard_id,
      subject_id,
      chapter_id,
      language: language.toLowerCase(),
      translated_text,
      audio_path,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: LOCALIZED_CONTENT_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Localized content created successfully', data: item });
  } catch (error) {
    console.error('CreateLocalizedContent Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create localized content', error: error.message });
  }
}

// 2. Get Localized Versions by Material
async function getLocalizedVersionsByMaterial(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });

    // Assumes GSI 'materialId-index' with partition key material_id
    const params = {
      TableName: LOCALIZED_CONTENT_TABLE,
      IndexName: 'materialId-index',
      KeyConditionExpression: 'material_id = :materialId',
      ExpressionAttributeValues: { ':materialId': materialId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetLocalizedVersionsByMaterial Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve localized versions', error: error.message });
  }
}

// 3. Get Localized Content by ID
async function getLocalizedContentById(event) {
  try {
    const localizedId = event.pathParameters?.localizedId;
    if (!localizedId) return createResponse(400, { success: false, message: 'localizedId is required' });

    const result = await dynamoDB.get({ 
      TableName: LOCALIZED_CONTENT_TABLE, 
      Key: { localized_id: localizedId } 
    }).promise();

    if (!result.Item) return createResponse(404, { success: false, message: 'Localized content not found' });

    return createResponse(200, { success: true, data: result.Item });
  } catch (error) {
    console.error('GetLocalizedContentById Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve localized content', error: error.message });
  }
}

// 4. Update Localized Content
async function updateLocalizedContent(event) {
  try {
    const localizedId = event.pathParameters?.localizedId;
    if (!localizedId) return createResponse(400, { success: false, message: 'localizedId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['translated_text', 'audio_path', 'language', 'status'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        if (key === 'language' || key === 'status') {
          expressionAttributeValues[`:${key}`] = updates[key].toLowerCase();
        } else {
          expressionAttributeValues[`:${key}`] = updates[key];
        }
      }
    });

    if (Object.keys(expressionAttributeNames).length === 0) {
      return createResponse(400, { success: false, message: 'No valid fields to update' });
    }

    const params = {
      TableName: LOCALIZED_CONTENT_TABLE,
      Key: { localized_id: localizedId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Localized content updated successfully', data: result.Attributes });
  } catch (error) {
    console.error('UpdateLocalizedContent Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update localized content', error: error.message });
  }
}

// 5. Delete Localized Content (soft delete)
async function deleteLocalizedContent(event) {
  try {
    const localizedId = event.pathParameters?.localizedId;
    if (!localizedId) return createResponse(400, { success: false, message: 'localizedId is required' });

    const params = {
      TableName: LOCALIZED_CONTENT_TABLE,
      Key: { localized_id: localizedId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Localized content marked inactive', data: result.Attributes });
  } catch (error) {
    console.error('DeleteLocalizedContent Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete localized content', error: error.message });
  }
}

// 6. Get by Language
async function getLocalizedContentByLanguage(event) {
  try {
    const langCode = event.pathParameters?.langCode;
    if (!langCode) return createResponse(400, { success: false, message: 'langCode is required' });

    // Assumes GSI 'language-index' with partition key language
    const params = {
      TableName: LOCALIZED_CONTENT_TABLE,
      IndexName: 'language-index',
      KeyConditionExpression: '#language = :langCode',
      ExpressionAttributeNames: { '#language': 'language' },
      ExpressionAttributeValues: { ':langCode': langCode.toLowerCase() }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetLocalizedContentByLanguage Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve localized content by language', error: error.message });
  }
}

module.exports = {
  createLocalizedContent,
  getLocalizedVersionsByMaterial,
  getLocalizedContentById,
  updateLocalizedContent,
  deleteLocalizedContent,
  getLocalizedContentByLanguage
};
