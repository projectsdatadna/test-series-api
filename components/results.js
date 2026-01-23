const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const { Parser } = require('json2csv'); // for CSV export

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const RESULTS_TABLE = process.env.RESULTS_TABLE || 'TestResults';

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

// 1. Generate Result after exam submission
async function generateResult(event) {
  try {
    if (!event || !event.body) return createResponse(400, { success: false, message: 'Request body is required' });
    const { user_id, exam_id, total_score, total_possible, remarks = '', status = 'active' } = JSON.parse(event.body);

    if (!user_id || !exam_id || total_score === undefined || total_possible === undefined) {
      return createResponse(400, { success: false, message: 'Missing required fields' });
    }

    const percentage = total_possible > 0 ? (total_score / total_possible) * 100 : 0;
    const now = new Date().toISOString();
    const resultId = uuidv4();

    const item = {
      result_id: resultId,
      user_id,
      exam_id,
      total_score,
      total_possible,
      percentage,
      remarks,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: RESULTS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Result generated', data: item });
  } catch (error) {
    console.error('GenerateResult Error:', error);
    return createResponse(500, { success: false, message: 'Failed to generate result', error: error.message });
  }
}

// 2. Get User Result for Exam
async function getUserResult(event) {
  try {
    const userId = event.pathParameters?.userId;
    const examId = event.pathParameters?.examId;
    if (!userId || !examId) return createResponse(400, { success: false, message: 'userId and examId are required' });

    // Assume GSI 'userExam-index' on user_id + exam_id
    const params = {
      TableName: RESULTS_TABLE,
      IndexName: 'userExam-index',
      KeyConditionExpression: 'user_id = :userId AND exam_id = :examId',
      ExpressionAttributeValues: { ':userId': userId, ':examId': examId },
      Limit: 1
    };

    const result = await dynamoDB.query(params).promise();
    if (result.Items.length === 0) return createResponse(404, { success: false, message: 'Result not found' });

    return createResponse(200, { success: true, data: result.Items[0] });
  } catch (error) {
    console.error('GetUserResult Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get user result', error: error.message });
  }
}

// 3. Get All Results for Exam
async function getAllResultsForExam(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });

    // Assume GSI 'examId-index' on exam_id
    const params = {
      TableName: RESULTS_TABLE,
      IndexName: 'examId-index',
      KeyConditionExpression: 'exam_id = :examId',
      ExpressionAttributeValues: { ':examId': examId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetAllResultsForExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get results for exam', error: error.message });
  }
}

// 4. Get All Results for User
async function getAllResultsForUser(event) {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    // Assume GSI 'userId-index' on user_id
    const params = {
      TableName: RESULTS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetAllResultsForUser Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get results for user', error: error.message });
  }
}

// 5. Update Remarks or Marks
async function updateResult(event) {
  try {
    const resultId = event.pathParameters?.resultId;
    if (!resultId) return createResponse(400, { success: false, message: 'resultId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['remarks', 'total_score', 'percentage', 'status'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = key === 'status' ? updates[key].toLowerCase() : updates[key];
      }
    });

    if (Object.keys(expressionAttributeNames).length === 0) {
      return createResponse(400, { success: false, message: 'No valid fields to update' });
    }

    const params = {
      TableName: RESULTS_TABLE,
      Key: { result_id: resultId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Result updated', data: result.Attributes });
  } catch (error) {
    console.error('UpdateResult Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update result', error: error.message });
  }
}

// 6. Delete Result (soft delete)
async function deleteResult(event) {
  try {
    const resultId = event.pathParameters?.resultId;
    if (!resultId) return createResponse(400, { success: false, message: 'resultId is required' });

    const params = {
      TableName: RESULTS_TABLE,
      Key: { result_id: resultId },
      UpdateExpression: 'SET #status = :status, updated_at = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updatedAt': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Result marked inactive', data: result.Attributes });
  } catch (error) {
    console.error('DeleteResult Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete result', error: error.message });
  }
}

// 7. Leaderboard - top students by total_score in an exam
async function getLeaderboard(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });

    const params = {
      TableName: RESULTS_TABLE,
      IndexName: 'examId-index',
      KeyConditionExpression: 'exam_id = :examId',
      ExpressionAttributeValues: { ':examId': examId }
    };

    const result = await dynamoDB.query(params).promise();

    const sorted = result.Items.sort((a,b) => (b.total_score || 0) - (a.total_score || 0)).slice(0, 10);

    return createResponse(200, { success: true, data: sorted });
  } catch (error) {
    console.error('GetLeaderboard Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get leaderboard', error: error.message });
  }
}

// 8. Get Result Summary (analytics)
async function getResultSummary(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });

    const params = {
      TableName: RESULTS_TABLE,
      IndexName: 'examId-index',
      KeyConditionExpression: 'exam_id = :examId',
      ExpressionAttributeValues: { ':examId': examId }
    };

    const result = await dynamoDB.query(params).promise();

    const items = result.Items;

    const totalStudents = items.length;
    const totalMarksSum = items.reduce((sum, r) => sum + (r.total_score || 0), 0);
    const avgMarks = totalStudents > 0 ? totalMarksSum / totalStudents : 0;
    const passCount = items.filter(r => r.percentage >= 40).length; // Example pass % threshold
    const passPercentage = totalStudents > 0 ? (passCount / totalStudents) * 100 : 0;

    const topPerformers = items.sort((a,b) => (b.total_score || 0) - (a.total_score || 0)).slice(0, 5);

    return createResponse(200, {
      success: true,
      data: {
        totalStudents,
        avgMarks,
        passPercentage,
        topPerformers
      }
    });

  } catch (error) {
    console.error('GetResultSummary Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get result summary', error: error.message });
  }
}

// 9. Export Results (CSV)
async function exportResults(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });

    const params = {
      TableName: RESULTS_TABLE,
      IndexName: 'examId-index',
      KeyConditionExpression: 'exam_id = :examId',
      ExpressionAttributeValues: { ':examId': examId }
    };

    const result = await dynamoDB.query(params).promise();

    const fields = ['result_id', 'user_id', 'exam_id', 'total_score', 'total_possible', 'percentage', 'remarks', 'status', 'created_at'];

    const opts = { fields };
    const parser = new (require('json2csv').Parser)(opts);
    const csv = parser.parse(result.Items);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="exam_${examId}_results.csv"`
      },
      body: csv
    };

  } catch (error) {
    console.error('ExportResults Error:', error);
    return createResponse(500, { success: false, message: 'Failed to export results', error: error.message });
  }
}

module.exports = {
  generateResult: generateResult,
  getUserResult,
  getAllResultsForExam: getAllResultsForExam,
  getAllResultsForUser: getAllResultsForUser,
  updateResult,
  deleteResult,
  getLeaderboard,
  getResultSummary,
  exportResults,
  // submitAnswer,
  // getUserAnswers,
  // updateAnswer,
  // evaluateAnswer,
  // getAllExamAnswers,
  // deleteAnswer,
  // autoEvaluate,
  // submitExam
};
