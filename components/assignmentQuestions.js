const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const ASSIGNMENT_QUESTIONS_TABLE = process.env.ASSIGNMENT_QUESTIONS_TABLE || 'TestAssignmentQuestions';

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

// 1. Add Question to Assignment
async function addQuestion(event) {
  try {
    const assignmentId = event.pathParameters?.assignmentId;
    if (!assignmentId) return createResponse(400, { success: false, message: 'assignmentId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      courseId, standardId, subjectId, chapterId, sectionId,
      Aquestion_text, type, difficulty_level,
      marks, correct_answer, explanation,
      createdBy, status = 'active', url = null, language = null,
      tts_available = false, ai_tutor_enabled = false
    } = JSON.parse(event.body);

    // Validate required fields
    if (!Aquestion_text) return createResponse(400, { success: false, message: 'Question text is required' });
    if (!type) return createResponse(400, { success: false, message: 'Question type is required' });
    if (!difficulty_level) return createResponse(400, { success: false, message: 'Difficulty level is required' });
    if (!createdBy) return createResponse(400, { success: false, message: 'createdBy is required' });

    const validTypes = ['mcq', 'true_false', 'short', 'descriptive'];
    const validDifficulties = ['easy', 'medium', 'hard'];

    if (!validTypes.includes(type.toLowerCase())) {
      return createResponse(400, { success: false, message: `Invalid question type, must be one of: ${validTypes.join(', ')}` });
    }
    if (!validDifficulties.includes(difficulty_level.toLowerCase())) {
      return createResponse(400, { success: false, message: `Invalid difficulty_level, must be one of: ${validDifficulties.join(', ')}` });
    }

    const now = new Date().toISOString();
    const AquestionId = uuidv4();

    const item = {
      Aquestion_id: AquestionId,
      assignment_id: assignmentId,
      course_id: courseId || null,
      standard_id: standardId || null,
      subject_id: subjectId || null,
      chapter_id: chapterId || null,
      section_id: sectionId || null,
      Aquestion_text,
      type: type.toLowerCase(),
      difficulty_level: difficulty_level.toLowerCase(),
      marks,
      correct_answer: correct_answer || null,
      explanation: explanation || null,
      created_by: createdBy,
      status: status.toLowerCase(),
      url,
      language,
      tts_available,
      ai_tutor_enabled,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: ASSIGNMENT_QUESTIONS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Question added successfully', data: item });

  } catch (error) {
    console.error('AddQuestion Error:', error);
    return createResponse(500, { success: false, message: 'Failed to add question', error: error.message });
  }
}

// 2. Get All Questions for Assignment
async function getAllQuestions(event) {
  try {
    const assignmentId = event.pathParameters?.assignmentId;
    if (!assignmentId) return createResponse(400, { success: false, message: 'assignmentId is required' });

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    // Assumes GSI assignmentId-index exists with partition key assignment_id
    const params = {
      TableName: ASSIGNMENT_QUESTIONS_TABLE,
      IndexName: 'assignmentId-index', 
      KeyConditionExpression: 'assignment_id = :assignmentId',
      ExpressionAttributeValues: { ':assignmentId': assignmentId },
      Limit: limit
    };

    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(queryParams.lastKey, 'base64').toString());
    }

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, {
      success: true,
      data: result.Items,
      count: result.Items.length,
      nextToken: result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64') : undefined
    });
  } catch (error) {
    console.error('GetAllQuestions Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve questions', error: error.message });
  }
}

// 3. Get Question Details
async function getQuestionDetails(event) {
  try {
    const AquestionId = event.pathParameters?.AquestionId;
    if (!AquestionId) return createResponse(400, { success: false, message: 'AquestionId is required' });

    const result = await dynamoDB.get({
      TableName: ASSIGNMENT_QUESTIONS_TABLE,
      Key: { Aquestion_id: AquestionId }
    }).promise();

    if (!result.Item) return createResponse(404, { success: false, message: 'Question not found' });

    return createResponse(200, { success: true, data: result.Item });

  } catch (error) {
    console.error('GetQuestionDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve question details', error: error.message });
  }
}

// 4. Update Question
async function updateQuestion(event) {
  try {
    const AquestionId = event.pathParameters?.AquestionId;
    if (!AquestionId) return createResponse(400, { success: false, message: 'AquestionId is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['Aquestion_text', 'type', 'difficulty_level', 'marks', 'correct_answer', 'explanation', 'status', 'url', 'language', 'tts_available', 'ai_tutor_enabled'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        if (key === 'type' || key === 'difficulty_level' || key === 'status') {
          expressionAttributeValues[`:${key}`] = (updates[key] || '').toLowerCase();
        } else {
          expressionAttributeValues[`:${key}`] = updates[key];
        }
      }
    });

    if (Object.keys(expressionAttributeNames).length === 0) {
      return createResponse(400, { success: false, message: 'No valid fields to update' });
    }

    const params = {
      TableName: ASSIGNMENT_QUESTIONS_TABLE,
      Key: { Aquestion_id: AquestionId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Question updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateQuestion Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update question', error: error.message });
  }
}

// 5. Delete Question (soft delete)
async function deleteQuestion(event) {
  try {
    const AquestionId = event.pathParameters?.AquestionId;
    if (!AquestionId) return createResponse(400, { success: false, message: 'AquestionId is required' });

    const params = {
      TableName: ASSIGNMENT_QUESTIONS_TABLE,
      Key: { Aquestion_id: AquestionId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Question marked inactive', data: result.Attributes });
  } catch (error) {
    console.error('DeleteQuestion Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete question', error: error.message });
  }
}

module.exports = {
  addQuestion,
  getAllQuestions,
  getQuestionDetails,
  updateQuestion,
  deleteQuestion
};
