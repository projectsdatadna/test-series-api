const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const ASSIGNMENT_OPTIONS_TABLE = process.env.ASSIGNMENT_OPTIONS_TABLE || 'TestAssignmentQuestionOptions';

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

// 1. Add Option to Question
async function addOption(event) {
  try {
    const AquestionId = event.pathParameters?.AquestionId;
    if (!AquestionId) return createResponse(400, { success: false, message: 'AquestionId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      Aoption_text,
      is_correct = false,
      url = null,
      language = null,
      tts_available = false,
      ai_tutor_enabled = false
    } = JSON.parse(event.body);

    if (!Aoption_text) return createResponse(400, { success: false, message: 'Option text (Aoption_text) is required' });

    const now = new Date().toISOString();
    const AoptionId = uuidv4();

    const item = {
      Aoption_id: AoptionId,
      Aquestion_id: AquestionId,
      Aoption_text,
      is_correct,
      url,
      language,
      tts_available,
      ai_tutor_enabled,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: ASSIGNMENT_OPTIONS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Option added successfully', data: item });

  } catch (error) {
    console.error('AddOption Error:', error);
    return createResponse(500, { success: false, message: 'Failed to add option', error: error.message });
  }
}

// 2. Get All Options for a Question
async function getOptionsByQuestion(event) {
  try {
    const AquestionId = event.pathParameters?.AquestionId;
    if (!AquestionId) return createResponse(400, { success: false, message: 'AquestionId is required' });

    // Assumes a GSI 'questionId-index' with partition key Aquestion_id exists
    const params = {
      TableName: ASSIGNMENT_OPTIONS_TABLE,
      IndexName: 'questionId-index',
      KeyConditionExpression: 'Aquestion_id = :AquestionId',
      ExpressionAttributeValues: { ':AquestionId': AquestionId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items });

  } catch (error) {
    console.error('GetOptionsByQuestion Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve options', error: error.message });
  }
}

// 3. Update Option
async function updateOption(event) {
  try {
    const AoptionId = event.pathParameters?.AoptionId;
    if (!AoptionId) return createResponse(400, { success: false, message: 'AoptionId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['Aoption_text', 'is_correct', 'url', 'language', 'tts_available', 'ai_tutor_enabled'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = updates[key];
      }
    });

    if (Object.keys(expressionAttributeNames).length === 0) {
      return createResponse(400, { success: false, message: 'No valid fields to update' });
    }

    const params = {
      TableName: ASSIGNMENT_OPTIONS_TABLE,
      Key: { Aoption_id: AoptionId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Option updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateOption Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update option', error: error.message });
  }
}

// 4. Delete Option
async function deleteOption(event) {
  try {
    const AoptionId = event.pathParameters?.AoptionId;
    if (!AoptionId) return createResponse(400, { success: false, message: 'AoptionId is required' });

    await dynamoDB.delete({
      TableName: ASSIGNMENT_OPTIONS_TABLE,
      Key: { Aoption_id: AoptionId }
    }).promise();

    return createResponse(200, { success: true, message: 'Option deleted successfully' });

  } catch (error) {
    console.error('DeleteOption Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete option', error: error.message });
  }
}

module.exports = {
  addOption,
  getOptionsByQuestion,
  updateOption,
  deleteOption
};
