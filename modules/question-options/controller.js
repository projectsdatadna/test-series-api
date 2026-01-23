const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const QUESTION_OPTIONS_TABLE = process.env.QUESTION_OPTIONS_TABLE || 'TestQuestionOptions';

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
    const questionId = event.pathParameters?.questionId;
    if (!questionId) return createResponse(400, { success: false, message: 'questionId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const { option_text, is_correct = false } = JSON.parse(event.body);
    if (!option_text) return createResponse(400, { success: false, message: 'option_text is required' });

    const now = new Date().toISOString();
    const optionId = uuidv4();

    const item = {
      option_id: optionId,
      question_id: questionId,
      option_text,
      is_correct,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: QUESTION_OPTIONS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Option added successfully', data: item });

  } catch (error) {
    console.error('AddOption Error:', error);
    return createResponse(500, { success: false, message: 'Failed to add option', error: error.message });
  }
}

// 2. Get Options for Question
async function getOptionsByQuestion(event) {
  try {
    const questionId = event.pathParameters?.questionId;
    if (!questionId) return createResponse(400, { success: false, message: 'questionId is required' });

    // Assumes GSI 'questionId-index' exists with partition key question_id
    const params = {
      TableName: QUESTION_OPTIONS_TABLE,
      IndexName: 'questionId-index',
      KeyConditionExpression: 'question_id = :questionId',
      ExpressionAttributeValues: { ':questionId': questionId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });

  } catch (error) {
    console.error('GetOptionsByQuestion Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve options', error: error.message });
  }
}

// 3. Update Option
async function updateOption(event) {
  try {
    const optionId = event.pathParameters?.optionId;
    if (!optionId) return createResponse(400, { success: false, message: 'optionId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['option_text', 'is_correct'];

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
      TableName: QUESTION_OPTIONS_TABLE,
      Key: { option_id: optionId },
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
    const optionId = event.pathParameters?.optionId;
    if (!optionId) return createResponse(400, { success: false, message: 'optionId is required' });

    await dynamoDB.delete({ TableName: QUESTION_OPTIONS_TABLE, Key: { option_id: optionId } }).promise();

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
