const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const FLASHCARDS_TABLE = process.env.FLASHCARDS_TABLE || 'TestFlashcards';

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

// 1. Create Flashcard
async function createFlashcard(event) {
  try {
    if (!event || !event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      material_id,
      question,
      answer,
      difficulty,
      course_id = null,
      section_id = null,
      standard_id = null,
      subject_id = null,
      chapter_id = null,
      status = 'active'
    } = JSON.parse(event.body);

    if (!material_id) return createResponse(400, { success: false, message: 'material_id is required' });
    if (!question) return createResponse(400, { success: false, message: 'question is required' });
    if (!answer) return createResponse(400, { success: false, message: 'answer is required' });
    if (!difficulty) return createResponse(400, { success: false, message: 'difficulty is required' });

    const validDifficulty = ['basic', 'intermediate', 'advanced'];
    if (!validDifficulty.includes(difficulty.toLowerCase())) {
      return createResponse(400, { 
        success: false, 
        message: `Invalid difficulty. Must be one of: ${validDifficulty.join(', ')}` 
      });
    }

    const now = new Date().toISOString();
    const flashcardId = uuidv4();

    const item = {
      flashcard_id: flashcardId,
      material_id,
      course_id,
      section_id,
      standard_id,
      subject_id,
      chapter_id,
      question,
      answer,
      difficulty: difficulty.toLowerCase(),
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: FLASHCARDS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Flashcard created successfully', data: item });
  } catch (error) {
    console.error('CreateFlashcard Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create flashcard', error: error.message });
  }
}

// 2. Get All Flashcards (with filters)
async function getAllFlashcards(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    let params = {
      TableName: FLASHCARDS_TABLE,
      Limit: limit
    };

    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (queryParams.courseId) {
      filterExpressions.push('#course_id = :courseId');
      expressionAttributeNames['#course_id'] = 'course_id';
      expressionAttributeValues[':courseId'] = queryParams.courseId;
    }

    if (queryParams.subjectId) {
      filterExpressions.push('#subject_id = :subjectId');
      expressionAttributeNames['#subject_id'] = 'subject_id';
      expressionAttributeValues[':subjectId'] = queryParams.subjectId;
    }

    if (queryParams.difficulty) {
      filterExpressions.push('#difficulty = :difficulty');
      expressionAttributeNames['#difficulty'] = 'difficulty';
      expressionAttributeValues[':difficulty'] = queryParams.difficulty.toLowerCase();
    }

    if (queryParams.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = queryParams.status.toLowerCase();
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
    console.error('GetAllFlashcards Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve flashcards', error: error.message });
  }
}

// 3. Get Flashcard Details
async function getFlashcardDetails(event) {
  try {
    const flashcardId = event.pathParameters?.flashcardId;
    if (!flashcardId) return createResponse(400, { success: false, message: 'flashcardId is required' });

    const result = await dynamoDB.get({ 
      TableName: FLASHCARDS_TABLE, 
      Key: { flashcard_id: flashcardId } 
    }).promise();

    if (!result.Item) return createResponse(404, { success: false, message: 'Flashcard not found' });

    return createResponse(200, { success: true, data: result.Item });
  } catch (error) {
    console.error('GetFlashcardDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve flashcard details', error: error.message });
  }
}

// 4. Update Flashcard
async function updateFlashcard(event) {
  try {
    const flashcardId = event.pathParameters?.flashcardId;
    if (!flashcardId) return createResponse(400, { success: false, message: 'flashcardId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['question', 'answer', 'difficulty', 'status'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        if (key === 'difficulty' || key === 'status') {
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
      TableName: FLASHCARDS_TABLE,
      Key: { flashcard_id: flashcardId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Flashcard updated successfully', data: result.Attributes });
  } catch (error) {
    console.error('UpdateFlashcard Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update flashcard', error: error.message });
  }
}

// 5. Delete Flashcard (soft delete)
async function deleteFlashcard(event) {
  try {
    const flashcardId = event.pathParameters?.flashcardId;
    if (!flashcardId) return createResponse(400, { success: false, message: 'flashcardId is required' });

    const params = {
      TableName: FLASHCARDS_TABLE,
      Key: { flashcard_id: flashcardId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Flashcard marked inactive', data: result.Attributes });
  } catch (error) {
    console.error('DeleteFlashcard Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete flashcard', error: error.message });
  }
}

// 6. Get Flashcards by Material
async function getFlashcardsByMaterial(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });

    // Assumes GSI 'materialId-index' with partition key material_id
    const params = {
      TableName: FLASHCARDS_TABLE,
      IndexName: 'materialId-index',
      KeyConditionExpression: 'material_id = :materialId',
      ExpressionAttributeValues: { ':materialId': materialId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetFlashcardsByMaterial Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve flashcards by material', error: error.message });
  }
}

// 7. Get Flashcards by Subject
async function getFlashcardsBySubject(event) {
  try {
    const subjectId = event.pathParameters?.subjectId;
    if (!subjectId) return createResponse(400, { success: false, message: 'subjectId is required' });

    // Assumes GSI 'subjectId-index' with partition key subject_id
    const params = {
      TableName: FLASHCARDS_TABLE,
      IndexName: 'subjectId-index',
      KeyConditionExpression: 'subject_id = :subjectId',
      ExpressionAttributeValues: { ':subjectId': subjectId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetFlashcardsBySubject Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve flashcards by subject', error: error.message });
  }
}

module.exports = {
  createFlashcard,
  getAllFlashcards,
  getFlashcardDetails,
  updateFlashcard,
  deleteFlashcard,
  getFlashcardsByMaterial,
  getFlashcardsBySubject
};
