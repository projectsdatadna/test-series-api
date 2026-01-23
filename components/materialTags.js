const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const MATERIAL_TAGS_TABLE = process.env.MATERIAL_TAGS_TABLE || 'TestMaterialTags';
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

// 1. Create Tag
async function createTag(event) {
  try {
    if (!event || !event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const { tag_name } = JSON.parse(event.body);
    if (!tag_name) return createResponse(400, { success: false, message: 'tag_name is required' });

    const now = new Date().toISOString();
    const tagId = uuidv4();

    const item = {
      tag_id: tagId,
      tag_name,
      status: 'active',
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: MATERIAL_TAGS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Tag created successfully', data: item });
  } catch (error) {
    console.error('CreateTag Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create tag', error: error.message });
  }
}

// 2. Get All Tags
async function getAllTags(event) {
  try {
    const params = { TableName: MATERIAL_TAGS_TABLE };

    const result = await dynamoDB.scan(params).promise();

    return createResponse(200, { success: true, data: result.Items });
  } catch (error) {
    console.error('GetAllTags Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve tags', error: error.message });
  }
}

// 3. Get Tag Details
async function getTagDetails(event) {
  try {
    const tagId = event.pathParameters?.tagId;
    if (!tagId) return createResponse(400, { success: false, message: 'tagId is required' });

    const tagResult = await dynamoDB.get({ TableName: MATERIAL_TAGS_TABLE, Key: { tag_id: tagId } }).promise();
    if (!tagResult.Item) return createResponse(404, { success: false, message: 'Tag not found' });

    return createResponse(200, { success: true, data: tagResult.Item });
  } catch (error) {
    console.error('GetTagDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve tag details', error: error.message });
  }
}

// 4. Update Tag
async function updateTag(event) {
  try {
    const tagId = event.pathParameters?.tagId;
    if (!tagId) return createResponse(400, { success: false, message: 'tagId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['tag_name', 'status'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = key === 'status' ? updates[key].toLowerCase() : updates[key];
      }
    });

    if (Object.keys(expressionAttributeNames).length === 0) {
      return createResponse(400, { success: false, message: 'No valid fields to update' });
    }

    const params = {
      TableName: MATERIAL_TAGS_TABLE,
      Key: { tag_id: tagId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Tag updated successfully', data: result.Attributes });
  } catch (error) {
    console.error('UpdateTag Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update tag', error: error.message });
  }
}

// 5. Delete Tag (soft delete)
async function deleteTag(event) {
  try {
    const tagId = event.pathParameters?.tagId;
    if (!tagId) return createResponse(400, { success: false, message: 'tagId is required' });

    const params = {
      TableName: MATERIAL_TAGS_TABLE,
      Key: { tag_id: tagId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Tag marked inactive', data: result.Attributes });
  } catch (error) {
    console.error('DeleteTag Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete tag', error: error.message });
  }
}

// 6. Get Materials by Tag
async function getMaterialsByTag(event) {
  try {
    const tagId = event.pathParameters?.tagId;
    if (!tagId) return createResponse(400, { success: false, message: 'tagId is required' });

    // DynamoDB does not support direct query by list element. Use Scan with FilterExpression contains.
    // MATERIALS_TABLE 'tags' is a list attribute.

    const params = {
      TableName: MATERIALS_TABLE,
      FilterExpression: 'contains (#tags, :tagName)',
      ExpressionAttributeNames: { '#tags': 'tags' },
      ExpressionAttributeValues: { ':tagName': tagId } // Assumes tagId or tagName stored in tags
    };

    const result = await dynamoDB.scan(params).promise();

    return createResponse(200, { success: true, data: result.Items });
  } catch (error) {
    console.error('GetMaterialsByTag Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve materials for tag', error: error.message });
  }
}

module.exports = {
  createTag,
  getAllTags,
  getTagDetails,
  updateTag,
  deleteTag,
  getMaterialsByTag
};
