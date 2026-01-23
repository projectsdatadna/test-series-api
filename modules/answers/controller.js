const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const ANSWERS_TABLE = process.env.ANSWERS_TABLE || 'TestAnswers';

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

// 1. Start Exam (initialize answer session)
// Typically this might create a record or mark exam status per user - simplified here
async function startExam(event) {
  try {
    const examId = event.pathParameters?.examId;
    const userId = event.queryStringParameters?.userId;
    if (!examId || !userId) return createResponse(400, { success: false, message: 'examId and userId are required' });

    // For example, create a placeholder record or return exam questions for user start
    // Here just acknowledge start
    return createResponse(200, { success: true, message: 'Exam attempt started' });
  } catch (error) {
    console.error('StartExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to start exam', error: error.message });
  }
}

// 2. Submit Answer for a Question
async function submitAnswer(event) {
  try {
    const examId = event.pathParameters?.examId;
    const questionId = event.pathParameters?.questionId;
    if (!examId || !questionId) return createResponse(400, { success: false, message: 'examId and questionId are required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      user_id,
      course_id = null,
      answer_text,
      is_correct = null,
      marks_awarded = null,
      evaluated_by = null,
      evaluated_at = null,
      status = 'pending'
    } = JSON.parse(event.body);

    if (!user_id || answer_text === undefined) return createResponse(400, { success: false, message: 'user_id and answer_text are required' });

    const now = new Date().toISOString();
    const answerId = uuidv4();

    const item = {
      answer_id: answerId,
      question_id: questionId,
      exam_id: examId,
      user_id,
      course_id,
      answer_text,
      is_correct,
      marks_awarded,
      evaluated_by,
      evaluated_at,
      status,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: ANSWERS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Answer submitted', data: item });

  } catch (error) {
    console.error('SubmitAnswer Error:', error);
    return createResponse(500, { success: false, message: 'Failed to submit answer', error: error.message });
  }
}

// 3. Get All Answers by User for Exam
async function getUserAnswers(event) {
  try {
    const examId = event.pathParameters?.examId;
    const userId = event.pathParameters?.userId;
    if (!examId || !userId) return createResponse(400, { success: false, message: 'examId and userId are required' });

    // Assumes GSI 'examUser-index' with partition key exam_id and sort key user_id
    const params = {
      TableName: ANSWERS_TABLE,
      IndexName: 'examUser-index',
      KeyConditionExpression: 'exam_id = :examId AND user_id = :userId',
      ExpressionAttributeValues: {
        ':examId': examId,
        ':userId': userId
      }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetUserAnswers Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get user answers', error: error.message });
  }
}

// 4. Update Answer (resubmit before exam closes)
async function updateAnswer(event) {
  try {
    const answerId = event.pathParameters?.answerId;
    if (!answerId) return createResponse(400, { success: false, message: 'answerId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['answer_text', 'status'];

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
      TableName: ANSWERS_TABLE,
      Key: { answer_id: answerId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Answer updated', data: result.Attributes });

  } catch (error) {
    console.error('UpdateAnswer Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update answer', error: error.message });
  }
}

// 5. Evaluate Answer (Teacher marks and evaluates)
async function evaluateAnswer(event) {
  try {
    const answerId = event.pathParameters?.answerId;
    if (!answerId) return createResponse(400, { success: false, message: 'answerId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const { marks_awarded, is_correct, evaluated_by } = JSON.parse(event.body);
    if (marks_awarded === undefined || is_correct === undefined || !evaluated_by) {
      return createResponse(400, { success: false, message: 'marks_awarded, is_correct and evaluated_by are required' });
    }

    const params = {
      TableName: ANSWERS_TABLE,
      Key: { answer_id: answerId },
      UpdateExpression: 'SET marks_awarded = :marks, is_correct = :correct, evaluated_by = :evalBy, evaluated_at = :evalAt, status = :status, updated_at = :updatedAt',
      ExpressionAttributeValues: {
        ':marks': marks_awarded,
        ':correct': is_correct,
        ':evalBy': evaluated_by,
        ':evalAt': new Date().toISOString(),
        ':status': 'evaluated',
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Answer evaluated', data: result.Attributes });

  } catch (error) {
    console.error('EvaluateAnswer Error:', error);
    return createResponse(500, { success: false, message: 'Failed to evaluate answer', error: error.message });
  }
}

// 6. Get All Answers for Exam
async function getAllExamAnswers(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });

    // Assumes GSI 'examId-index' on exam_id
    const params = {
      TableName: ANSWERS_TABLE,
      IndexName: 'examId-index',
      KeyConditionExpression: 'exam_id = :examId',
      ExpressionAttributeValues: { ':examId': examId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetAllExamAnswers Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get exam answers', error: error.message });
  }
}

// 7. Delete Answer (admin only)
async function deleteAnswer(event) {
  try {
    const answerId = event.pathParameters?.answerId;
    if (!answerId) return createResponse(400, { success: false, message: 'answerId is required' });

    await dynamoDB.delete({ TableName: ANSWERS_TABLE, Key: { answer_id: answerId } }).promise();

    return createResponse(200, { success: true, message: 'Answer deleted' });
  } catch (error) {
    console.error('DeleteAnswer Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete answer', error: error.message });
  }
}

// 8. Auto Evaluate Objective (example for MCQ, True/False)
async function autoEvaluate(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });

    // Fetch all pending answers for exam
    // Simplified auto-eval: compare submitted answer_text with correct_answer of question

    // Assume fetching answers and questions is done here; this is a schematic outline

    // Return success with count updated
    return createResponse(200, { success: true, message: 'Auto evaluation completed' });

  } catch (error) {
    console.error('AutoEvaluate Error:', error);
    return createResponse(500, { success: false, message: 'Failed auto evaluation', error: error.message });
  }
}

// 9. Submit Exam (finalize)
async function submitExam(event) {
  try {
    const examId = event.pathParameters?.examId;
    const userId = event.queryStringParameters?.userId;
    if (!examId || !userId) return createResponse(400, { success: false, message: 'examId and userId are required' });

    // Mark exam attempt as submitted for user, etc.
    // Implementation depends on your exam attempt tracking model.

    return createResponse(200, { success: true, message: 'Exam submitted successfully' });
  } catch (error) {
    console.error('SubmitExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to submit exam', error: error.message });
  }
}

module.exports = {
  startExam,
  submitAnswer,
  getUserAnswers,
  updateAnswer,
  evaluateAnswer,
  getAllExamAnswers,
  deleteAnswer,
  autoEvaluate,
  submitExam
};
