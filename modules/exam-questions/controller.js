const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const EXAM_QUESTIONS_TABLE = process.env.EXAM_QUESTIONS_TABLE || 'TestExamQuestions';

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

// 1. Add Question to Exam
async function addQuestionToExam(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const { question_id, order_no = null, marks = null } = JSON.parse(event.body);
    if (!question_id) return createResponse(400, { success: false, message: 'question_id is required' });

    const now = new Date().toISOString();
    const mappingId = uuidv4();

    const item = {
      mapping_id: mappingId,
      exam_id: examId,
      question_id,
      order_no,
      marks,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: EXAM_QUESTIONS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Question added to exam', data: item });

  } catch (error) {
    console.error('AddQuestionToExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to add question to exam', error: error.message });
  }
}

// 2. Get Exam Questions
async function getExamQuestions(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });

    // Assuming GSI 'examId-index' with partition key exam_id
    const params = {
      TableName: EXAM_QUESTIONS_TABLE,
      IndexName: 'examId-index',
      KeyConditionExpression: 'exam_id = :examId',
      ExpressionAttributeValues: { ':examId': examId }
    };

    const result = await dynamoDB.query(params).promise();

    // Optional: sort by order_no
    const sortedItems = result.Items.sort((a, b) => (a.order_no || 0) - (b.order_no || 0));

    return createResponse(200, { success: true, data: sortedItems });
  } catch (error) {
    console.error('GetExamQuestions Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get exam questions', error: error.message });
  }
}

// 3. Update Question Order or Marks
async function updateExamQuestion(event) {
  try {
    const mappingId = event.pathParameters?.mappingId;
    if (!mappingId) return createResponse(400, { success: false, message: 'mappingId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['order_no', 'marks'];

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
      TableName: EXAM_QUESTIONS_TABLE,
      Key: { mapping_id: mappingId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Exam question updated', data: result.Attributes });

  } catch (error) {
    console.error('UpdateExamQuestion Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update exam question', error: error.message });
  }
}

// 4. Remove Question from Exam
async function removeQuestionFromExam(event) {
  try {
    const mappingId = event.pathParameters?.mappingId;
    if (!mappingId) return createResponse(400, { success: false, message: 'mappingId is required' });

    await dynamoDB.delete({ TableName: EXAM_QUESTIONS_TABLE, Key: { mapping_id: mappingId } }).promise();

    return createResponse(200, { success: true, message: 'Question removed from exam' });

  } catch (error) {
    console.error('RemoveQuestionFromExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to remove question', error: error.message });
  }
}

// 5. Shuffle Exam Questions
async function shuffleExamQuestions(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });

    // Get all questions for exam
    const params = {
      TableName: EXAM_QUESTIONS_TABLE,
      IndexName: 'examId-index',
      KeyConditionExpression: 'exam_id = :examId',
      ExpressionAttributeValues: { ':examId': examId }
    };

    const result = await dynamoDB.query(params).promise();

    const items = result.Items;

    // Shuffle array using Fisher-Yates algorithm
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i].order_no, items[j].order_no] = [items[j].order_no, items[i].order_no];
    }

    // Batch update shuffled order_no
    const updatePromises = items.map(item => {
      return dynamoDB.update({
        TableName: EXAM_QUESTIONS_TABLE,
        Key: { mapping_id: item.mapping_id },
        UpdateExpression: 'SET order_no = :order_no, updated_at = :updated_at',
        ExpressionAttributeValues: {
          ':order_no': item.order_no,
          ':updated_at': new Date().toISOString()
        }
      }).promise();
    });

    await Promise.all(updatePromises);

    return createResponse(200, { success: true, message: 'Exam questions shuffled' });

  } catch (error) {
    console.error('ShuffleExamQuestions Error:', error);
    return createResponse(500, { success: false, message: 'Failed to shuffle exam questions', error: error.message });
  }
}

module.exports = {
  addQuestionToExam,
  getExamQuestions,
  updateExamQuestion,
  removeQuestionFromExam,
  shuffleExamQuestions
};
