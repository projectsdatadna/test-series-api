const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const ASSIGNMENT_ANSWERS_TABLE = process.env.ASSIGNMENT_ANSWERS_TABLE || 'TestAssignmentAnswers';

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

// 1. Add Answer to Question
async function addAnswer(event) {
  try {
    const AquestionId = event.pathParameters?.AquestionId;
    if (!AquestionId) return createResponse(400, { success: false, message: 'AquestionId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      assignmentId,
      userId,
      courseId,
      Aanswer_text,
      is_correct = null,
      marks_awarded = null,
      evaluated_by = null,
      evaluated_at = null,
      status = 'pending',
      url = null,
      language = null,
      tts_available = false,
      ai_tutor_enabled = false
    } = JSON.parse(event.body);

    if (!assignmentId) return createResponse(400, { success: false, message: 'assignmentId is required' });
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });
    if (!Aanswer_text) return createResponse(400, { success: false, message: 'Aanswer_text is required' });

    const now = new Date().toISOString();
    const AanswerId = uuidv4();

    const item = {
      Aanswer_id: AanswerId,
      Aquestion_id: AquestionId,
      assignment_id: assignmentId,
      user_id: userId,
      course_id: courseId || null,
      Aanswer_text,
      is_correct,
      marks_awarded,
      evaluated_by,
      evaluated_at,
      status: status.toLowerCase(),
      url,
      language,
      tts_available,
      ai_tutor_enabled,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: ASSIGNMENT_ANSWERS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Answer added successfully', data: item });

  } catch (error) {
    console.error('AddAnswer Error:', error);
    return createResponse(500, { success: false, message: 'Failed to add answer', error: error.message });
  }
}

// 2. Get Answers by Question
async function getAnswersByQuestion(event) {
  try {
    const AquestionId = event.pathParameters?.AquestionId;
    if (!AquestionId) return createResponse(400, { success: false, message: 'AquestionId is required' });

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    // Assume GSI 'questionId-index' exists with partition key Aquestion_id
    const params = {
      TableName: ASSIGNMENT_ANSWERS_TABLE,
      IndexName: 'questionId-index',
      KeyConditionExpression: 'Aquestion_id = :AquestionId',
      ExpressionAttributeValues: { ':AquestionId': AquestionId },
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
    console.error('GetAnswersByQuestion Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve answers', error: error.message });
  }
}

// 3. Update Answer
async function updateAnswer(event) {
  try {
    const AanswerId = event.pathParameters?.AanswerId;
    if (!AanswerId) return createResponse(400, { success: false, message: 'AanswerId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['Aanswer_text', 'is_correct', 'marks_awarded', 'evaluated_by', 'evaluated_at', 'status', 'url', 'language', 'tts_available', 'ai_tutor_enabled'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        if (key === 'status' && updates[key]) {
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
      TableName: ASSIGNMENT_ANSWERS_TABLE,
      Key: { Aanswer_id: AanswerId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Answer updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateAnswer Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update answer', error: error.message });
  }
}

// 4. Delete Answer (soft delete)
async function deleteAnswer(event) {
  try {
    const AanswerId = event.pathParameters?.AanswerId;
    if (!AanswerId) return createResponse(400, { success: false, message: 'AanswerId is required' });

    const params = {
      TableName: ASSIGNMENT_ANSWERS_TABLE,
      Key: { Aanswer_id: AanswerId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Answer marked inactive', data: result.Attributes });

  } catch (error) {
    console.error('DeleteAnswer Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete answer', error: error.message });
  }
}

module.exports = {
  addAnswer,
  getAnswersByQuestion,
  updateAnswer,
  deleteAnswer
};
