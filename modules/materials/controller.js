const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

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

// 1. Upload / Create Material
async function createMaterial(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const {
      title,
      type,
      url,
      language,
      ttsAvailable = false,
      aiTutorEnabled = false,
      isGamified = false,
      createdBy,
      status = 'active',
      courseId = null,
      subjectId = null,
      chapterId = null,
      sectionId = null,
      standardId = null
    } = JSON.parse(event.body);

    if (!title) return createResponse(400, { success: false, message: 'title is required' });
    if (!type) return createResponse(400, { success: false, message: 'type is required' });
    if (!createdBy) return createResponse(400, { success: false, message: 'createdBy is required' });

    const validTypes = ['text', 'video', 'image', 'pdf', 'simulation', 'flashcard', 'concept_map'];
    if (!validTypes.includes(type.toLowerCase())) {
      return createResponse(400, { success: false, message: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    const now = new Date().toISOString();
    const materialId = uuidv4();

    const item = {
      material_id: materialId,
      title,
      type: type.toLowerCase(),
      url,
      language,
      tts_available: ttsAvailable,
      ai_tutor_enabled: aiTutorEnabled,
      is_gamified: isGamified,
      created_by: createdBy,
      status: status.toLowerCase(),
      course_id: courseId,
      subject_id: subjectId,
      chapter_id: chapterId,
      section_id: sectionId,
      standard_id: standardId,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: MATERIALS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Material created successfully', data: item });

  } catch (error) {
    console.error('CreateMaterial Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create material', error: error.message });
  }
}

// 2. Get All Materials (with optional filters)
async function getAllMaterials(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const type = queryParams.type;
    const courseId = queryParams.courseId;
    const subjectId = queryParams.subjectId;

    let params = {
      TableName: MATERIALS_TABLE,
      Limit: limit
    };

    // Filter expressions for non-key attributes
    const filterExpressions = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    if (type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = type.toLowerCase();
    }
    if (courseId) {
      filterExpressions.push('#course_id = :courseId');
      expressionAttributeNames['#course_id'] = 'course_id';
      expressionAttributeValues[':courseId'] = courseId;
    }
    if (subjectId) {
      filterExpressions.push('#subject_id = :subjectId');
      expressionAttributeNames['#subject_id'] = 'subject_id';
      expressionAttributeValues[':subjectId'] = subjectId;
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
    console.error('GetAllMaterials Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve materials', error: error.message });
  }
}

// 3. Get Material Details
async function getMaterialDetails(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });

    const materialResult = await dynamoDB.get({
      TableName: MATERIALS_TABLE,
      Key: { material_id: materialId }
    }).promise();

    if (!materialResult.Item) return createResponse(404, { success: false, message: 'Material not found' });

    return createResponse(200, { success: true, data: materialResult.Item });

  } catch (error) {
    console.error('GetMaterialDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve material details', error: error.message });
  }
}

// 4. Update Material
async function updateMaterial(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['title', 'type', 'url', 'language', 'tts_available', 'ai_tutor_enabled', 'is_gamified', 'status', 'course_id', 'subject_id', 'chapter_id', 'section_id', 'standard_id'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        if (key === 'type' || key === 'status') {
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
      TableName: MATERIALS_TABLE,
      Key: { material_id: materialId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Material updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateMaterial Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update material', error: error.message });
  }
}

// 5. Delete Material (soft delete)
async function deleteMaterial(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });

    const params = {
      TableName: MATERIALS_TABLE,
      Key: { material_id: materialId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Material marked inactive', data: result.Attributes });

  } catch (error) {
    console.error('DeleteMaterial Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete material', error: error.message });
  }
}

// 6. Get Materials by Section
async function getMaterialsBySection(event) {
  try {
    const sectionId = event.pathParameters?.sectionId;
    if (!sectionId) return createResponse(400, { success: false, message: 'sectionId is required' });

    const params = {
      TableName: MATERIALS_TABLE,
      IndexName: 'sectionId-index', // GSI on section_id
      KeyConditionExpression: 'section_id = :sectionId',
      ExpressionAttributeValues: { ':sectionId': sectionId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items });

  } catch (error) {
    console.error('GetMaterialsBySection Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve materials by section', error: error.message });
  }
}

// 7. Search Materials by title or tag
async function searchMaterials(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const searchTerm = queryParams.q;
    if (!searchTerm) return createResponse(400, { success: false, message: 'Search query (q) is required' });

    // DynamoDB does not support advanced text search natively.
    // For demo, we do a Scan with FilterExpression using contains on title.

    const params = {
      TableName: MATERIALS_TABLE,
      FilterExpression: 'contains (#title, :searchTerm)',
      ExpressionAttributeNames: { '#title': 'title' },
      ExpressionAttributeValues: { ':searchTerm': searchTerm },
      Limit: 50
    };

    const result = await dynamoDB.scan(params).promise();

    return createResponse(200, { success: true, data: result.Items });

  } catch (error) {
    console.error('SearchMaterials Error:', error);
    return createResponse(500, { success: false, message: 'Failed to search materials', error: error.message });
  }
}

module.exports = {
  createMaterial,
  getAllMaterials,
  getMaterialDetails,
  updateMaterial,
  deleteMaterial,
  getMaterialsBySection,
  searchMaterials
};
