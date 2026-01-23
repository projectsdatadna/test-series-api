const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const QUESTIONS_TABLE = process.env.QUESTIONS_TABLE || 'TestQuestions';
const OPTIONS_TABLE = process.env.OPTIONS_TABLE || 'TestAssignmentQuestionOptions';

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

// 1. Create Question
async function createQuestion(event) {
  try {
    if (!event || !event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      standard_id, course_id, subject_id, chapter_id, section_id,
      question_text, type, difficulty_level, marks, correct_answer,
      explanation, created_by, status = 'active'
    } = JSON.parse(event.body);

    // Validate required fields
    if (!standard_id || !course_id || !subject_id || !chapter_id || !section_id || !question_text || !type || !difficulty_level || marks === undefined || !created_by) {
      return createResponse(400, { success: false, message: 'Missing required fields' });
    }

    const validTypes = ['mcq', 'true_false', 'short', 'descriptive'];
    if (!validTypes.includes(type.toLowerCase())) {
      return createResponse(400, { success: false, message: `Invalid type, must be one of: ${validTypes.join(', ')}` });
    }

    const validDifficulty = ['easy', 'medium', 'hard'];
    if (!validDifficulty.includes(difficulty_level.toLowerCase())) {
      return createResponse(400, { success: false, message: `Invalid difficulty_level, must be one of: ${validDifficulty.join(', ')}` });
    }

    const now = new Date().toISOString();
    const questionId = uuidv4();

    const item = {
      question_id: questionId,
      standard_id,
      course_id,
      subject_id,
      chapter_id,
      section_id,
      question_text,
      type: type.toLowerCase(),
      difficulty_level: difficulty_level.toLowerCase(),
      marks,
      correct_answer: correct_answer || null,
      explanation: explanation || null,
      created_by,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: QUESTIONS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Question created', data: item });
  } catch (error) {
    console.error('CreateQuestion Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create question', error: error.message });
  }
}

// 2. Get All Questions (with optional filters)
async function getAllQuestions(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    let params = {
      TableName: QUESTIONS_TABLE,
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
      filterExpressions.push('#difficulty_level = :difficulty');
      expressionAttributeNames['#difficulty_level'] = 'difficulty_level';
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

    return createResponse(200, {
      success: true,
      data: result.Items,
      count: result.Items.length,
      nextToken: result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64') : undefined
    });
  } catch (error) {
    console.error('GetAllQuestions Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get questions', error: error.message });
  }
}

// 3. Get Question Details (with options)
async function getQuestionDetails(event) {
  try {
    const questionId = event.pathParameters?.questionId;
    if (!questionId) return createResponse(400, { success: false, message: 'questionId is required' });

    const questionResult = await dynamoDB.get({ TableName: QUESTIONS_TABLE, Key: { question_id: questionId } }).promise();

    if (!questionResult.Item) return createResponse(404, { success: false, message: 'Question not found' });

    // Get linked options (MCQ)
    const optionsResult = await dynamoDB.query({
      TableName: OPTIONS_TABLE,
      IndexName: 'questionId-index',
      KeyConditionExpression: 'Aquestion_id = :questionId',
      ExpressionAttributeValues: { ':questionId': questionId }
    }).promise();

    const question = {
      ...questionResult.Item,
      options: optionsResult.Items
    };

    return createResponse(200, { success: true, data: question });
  } catch (error) {
    console.error('GetQuestionDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get question details', error: error.message });
  }
}

// 4. Update Question
async function updateQuestion(event) {
  try {
    const questionId = event.pathParameters?.questionId;
    if (!questionId) return createResponse(400, { success: false, message: 'questionId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['question_text', 'type', 'difficulty_level', 'marks', 'correct_answer', 'explanation', 'status'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        if (['type', 'difficulty_level', 'status'].includes(key)) {
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
      TableName: QUESTIONS_TABLE,
      Key: { question_id: questionId },
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
    const questionId = event.pathParameters?.questionId;
    if (!questionId) return createResponse(400, { success: false, message: 'questionId is required' });

    const params = {
      TableName: QUESTIONS_TABLE,
      Key: { question_id: questionId },
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

// 6. Get Questions by Subject
async function getQuestionsBySubject(event) {
  try {
    const subjectId = event.pathParameters?.subjectId;
    if (!subjectId) return createResponse(400, { success: false, message: 'subjectId is required' });

    const params = {
      TableName: QUESTIONS_TABLE,
      IndexName: 'subjectId-index',
      KeyConditionExpression: 'subject_id = :subjectId',
      ExpressionAttributeValues: { ':subjectId': subjectId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items });
  } catch (error) {
    console.error('GetQuestionsBySubject Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve questions by subject', error: error.message });
  }
}

// 7. Get Questions by Chapter
async function getQuestionsByChapter(event) {
  try {
    const chapterId = event.pathParameters?.chapterId;
    if (!chapterId) return createResponse(400, { success: false, message: 'chapterId is required' });

    const params = {
      TableName: QUESTIONS_TABLE,
      IndexName: 'chapterId-index',
      KeyConditionExpression: 'chapter_id = :chapterId',
      ExpressionAttributeValues: { ':chapterId': chapterId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items });
  } catch (error) {
    console.error('GetQuestionsByChapter Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve questions by chapter', error: error.message });
  }
}

// 8. Search Questions (by text)
async function searchQuestions(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const searchTerm = queryParams.query;
    if (!searchTerm) return createResponse(400, { success: false, message: 'Search query parameter "query" is required' });

    // DynamoDB does not support text search natively; scan with contains
    const params = {
      TableName: QUESTIONS_TABLE,
      FilterExpression: 'contains (#question_text, :searchTerm)',
      ExpressionAttributeNames: { '#question_text': 'question_text' },
      ExpressionAttributeValues: { ':searchTerm': searchTerm.toLowerCase() }
    };

    const result = await dynamoDB.scan(params).promise();

    return createResponse(200, { success: true, data: result.Items });
  } catch (error) {
    console.error('SearchQuestions Error:', error);
    return createResponse(500, { success: false, message: 'Failed to search questions', error: error.message });
  }
}

module.exports = {
  createQuestion,
  getAllQuestions,
  getQuestionDetails,
  updateQuestion,
  deleteQuestion,
  getQuestionsBySubject,
  getQuestionsByChapter,
  searchQuestions
};
