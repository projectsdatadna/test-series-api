const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const MATERIAL_MAPPINGS_TABLE = process.env.MATERIAL_MAPPINGS_TABLE || 'TestMaterialMappings';

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

// 1. Create Material Mapping
async function createMaterialMapping(event) {
  try {
    if (!event || !event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      material_id,
      course_id = null,
      standard_id = null,
      subject_id = null,
      chapter_id = null,
      section_id = null,
      relevance_score = null,
      status = 'active'
    } = JSON.parse(event.body);

    if (!material_id) return createResponse(400, { success: false, message: 'material_id is required' });

    const now = new Date().toISOString();
    const mappingId = uuidv4();

    const item = {
      mapping_id: mappingId,
      material_id,
      course_id,
      standard_id,
      subject_id,
      chapter_id,
      section_id,
      relevance_score,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: MATERIAL_MAPPINGS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Mapping created successfully', data: item });
  } catch (error) {
    console.error('CreateMaterialMapping Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create mapping', error: error.message });
  }
}

// 2. Get All Mappings (with optional filters)
async function getAllMaterialMappings(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    let params = {
      TableName: MATERIAL_MAPPINGS_TABLE,
      Limit: limit
    };

    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    // Add filters based on query params
    if (queryParams.courseId) {
      filterExpressions.push('#course_id = :courseId');
      expressionAttributeNames['#course_id'] = 'course_id';
      expressionAttributeValues[':courseId'] = queryParams.courseId;
    }

    if (queryParams.standardId) {
      filterExpressions.push('#standard_id = :standardId');
      expressionAttributeNames['#standard_id'] = 'standard_id';
      expressionAttributeValues[':standardId'] = queryParams.standardId;
    }

    if (queryParams.subjectId) {
      filterExpressions.push('#subject_id = :subjectId');
      expressionAttributeNames['#subject_id'] = 'subject_id';
      expressionAttributeValues[':subjectId'] = queryParams.subjectId;
    }

    if (queryParams.chapterId) {
      filterExpressions.push('#chapter_id = :chapterId');
      expressionAttributeNames['#chapter_id'] = 'chapter_id';
      expressionAttributeValues[':chapterId'] = queryParams.chapterId;
    }

    if (queryParams.sectionId) {
      filterExpressions.push('#section_id = :sectionId');
      expressionAttributeNames['#section_id'] = 'section_id';
      expressionAttributeValues[':sectionId'] = queryParams.sectionId;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
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
    console.error('GetAllMaterialMappings Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve mappings', error: error.message });
  }
}

// 3. Get Mapping by ID
async function getMaterialMappingById(event) {
  try {
    const mappingId = event.pathParameters?.mappingId;
    if (!mappingId) return createResponse(400, { success: false, message: 'mappingId is required' });

    const result = await dynamoDB.get({ TableName: MATERIAL_MAPPINGS_TABLE, Key: { mapping_id: mappingId } }).promise();

    if (!result.Item) return createResponse(404, { success: false, message: 'Mapping not found' });

    return createResponse(200, { success: true, data: result.Item });
  } catch (error) {
    console.error('GetMaterialMappingById Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get mapping', error: error.message });
  }
}

// 4. Update Mapping
async function updateMaterialMapping(event) {
  try {
    const mappingId = event.pathParameters?.mappingId;
    if (!mappingId) return createResponse(400, { success: false, message: 'mappingId is required' });

    const updates = JSON.parse(event.body);
    const allowedFields = ['relevance_score', 'status'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        if (key === 'status') {
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
      TableName: MATERIAL_MAPPINGS_TABLE,
      Key: { mapping_id: mappingId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();
    return createResponse(200, { success: true, message: 'Mapping updated', data: result.Attributes });
  } catch (error) {
    console.error('UpdateMaterialMapping Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update', error: error.message });
  }
}

// 5. Delete (Deactivate) Mapping
async function deleteMaterialMapping(event) {
  try {
    const mappingId = event.pathParameters?.mappingId;
    if (!mappingId) return createResponse(400, { success: false, message: 'mappingId is required' });

    const params = {
      TableName: MATERIAL_MAPPINGS_TABLE,
      Key: { mapping_id: mappingId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Mapping deactivated', data: result.Attributes });
  } catch (error) {
    console.error('DeleteMaterialMapping Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete', error: error.message });
  }
}

module.exports = {
  createMaterialMapping,
  getAllMaterialMappings,
  getMaterialMappingById,
  updateMaterialMapping,
  deleteMaterialMapping
};
