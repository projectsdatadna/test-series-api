const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const EXAMS_TABLE = process.env.EXAMS_TABLE || 'TestExams';

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

// 1. Create Exam
async function createExam(event) {
  try {
    if (!event || !event.body) return createResponse(400, { success: false, message: 'Request body is required' });
    const {
      course_id,
      standard_id,
      subject_id,
      chapter_ids,
      exam_name,
      description = null,
      type,
      start_time,
      end_time,
      duration_minutes,
      max_marks,
      created_by,
      status = 'draft'
    } = JSON.parse(event.body);

    // validations
    if (!course_id || !standard_id || !subject_id || !chapter_ids || !exam_name || !type || !start_time || !end_time || !duration_minutes || !max_marks || !created_by) {
      return createResponse(400, { success: false, message: 'Missing required fields' });
    }
    const validTypes = ['quiz', 'unit_test', 'term', 'mock_test'];
    if (!validTypes.includes(type)) {
      return createResponse(400, { success: false, message: `Invalid type, must be one of: ${validTypes.join(', ')}` });
    }

    const now = new Date().toISOString();
    const examId = uuidv4();

    const item = {
      exam_id: examId,
      course_id,
      standard_id,
      subject_id,
      chapter_ids,
      exam_name,
      description,
      type,
      start_time: new Date(start_time).toISOString(),
      end_time: new Date(end_time).toISOString(),
      duration_minutes,
      max_marks,
      created_by,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: EXAMS_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Exam created successfully', data: item });

  } catch (error) {
    console.error('CreateExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create exam', error: error.message });
  }
}

// 2. Get All Exams (optionally filtered by course, status, type)
async function getAllExams(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const courseId = queryParams.courseId;
    const status = queryParams.status;
    const type = queryParams.type;

    let params = {
      TableName: EXAMS_TABLE,
      Limit: limit
    };

    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (courseId) {
      filterExpressions.push('#course_id = :courseId');
      expressionAttributeNames['#course_id'] = 'course_id';
      expressionAttributeValues[':courseId'] = courseId;
    }
    if (status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = status.toLowerCase();
    }
    if (type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = type.toLowerCase();
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
    console.error('GetAllExams Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve exams', error: error.message });
  }
}

// 3. Get Exam Details
async function getExamDetails(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });
    const result = await dynamoDB.get({ TableName: EXAMS_TABLE, Key: { exam_id: examId } }).promise();
    if (!result.Item) return createResponse(404, { success: false, message: 'Exam not found' });
    return createResponse(200, { success: true, data: result.Item });
  } catch (error) {
    console.error('GetExamDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve exam', error: error.message });
  }
}

// 4. Update Exam
async function updateExam(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);
    const allowedFields = ['exam_name', 'description', 'type', 'start_time', 'end_time', 'duration_minutes', 'max_marks', 'status'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        if (['start_time', 'end_time'].includes(key)) {
          expressionAttributeValues[`:${key}`] = new Date(updates[key]).toISOString();
        } else if (key === 'status') {
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
      TableName: EXAMS_TABLE,
      Key: { exam_id: examId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Exam updated successfully', data: result.Attributes });
  } catch (error) {
    console.error('UpdateExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update exam', error: error.message });
  }
}

// 5. Delete or Archive Exam (Soft delete)
async function deleteExam(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });
    
    const params = {
      TableName: EXAMS_TABLE,
      Key: { exam_id: examId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'archived', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };
    const result = await dynamoDB.update(params).promise();
    return createResponse(200, { success: true, message: 'Exam archived successfully', data: result.Attributes });
  } catch (error) {
    console.error('DeleteExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to archive exam', error: error.message });
  }
}

// 6. Publish Exam
async function publishExam(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });
    const params = {
      TableName: EXAMS_TABLE,
      Key: { exam_id: examId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'published', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };
    const result = await dynamoDB.update(params).promise();
    return createResponse(200, { success: true, message: 'Exam published', data: result.Attributes });
  } catch (error) {
    console.error('PublishExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to publish exam', error: error.message });
  }
}

// 7. Complete Exam
async function completeExam(event) {
  try {
    const examId = event.pathParameters?.examId;
    if (!examId) return createResponse(400, { success: false, message: 'examId is required' });
    const params = {
      TableName: EXAMS_TABLE,
      Key: { exam_id: examId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'completed', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };
    const result = await dynamoDB.update(params).promise();
    return createResponse(200, { success: true, message: 'Exam marked as completed', data: result.Attributes });
  } catch (error) {
    console.error('CompleteExam Error:', error);
    return createResponse(500, { success: false, message: 'Failed to complete exam', error: error.message });
  }
}

// 8. List Exams by Course
async function getExamsByCourse(event) {
  try {
    const courseId = event.pathParameters?.courseId;
    if (!courseId) return createResponse(400, { success: false, message: 'courseId is required' });
    const params = {
      TableName: EXAMS_TABLE,
      FilterExpression: '#course_id = :courseId',
      ExpressionAttributeNames: { '#course_id': 'course_id' },
      ExpressionAttributeValues: { ':courseId': courseId }
    };
    const result = await dynamoDB.scan(params).promise();
    return createResponse(200, { success: true, data: result.Items });
  } catch (error) {
    console.error('GetExamsByCourse Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get exams by course', error: error.message });
  }
}

// 9. Get Active Exams
async function getActiveExams() {
  try {
    const params = {
      TableName: EXAMS_TABLE,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'published' } // or 'draft' or 'active'
    };
    const result = await dynamoDB.scan(params).promise();
    return createResponse(200, { success: true, data: result.Items });
  } catch (error) {
    console.error('GetActiveExams Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get active exams', error: error.message });
  }
}

// 10. Get Exam Schedule (sorted by start_time)
async function getExamSchedule() {
  try {
    const params = {
      TableName: EXAMS_TABLE,
      FilterExpression: '#status <> :archived',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':archived': 'archived' }
    };
    const result = await dynamoDB.scan(params).promise();
    const sorted = result.Items.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    return createResponse(200, { success: true, data: sorted });
  } catch (error) {
    console.error('GetExamSchedule Error:', error);
    return createResponse(500, { success: false, message: 'Failed to get exam schedule', error: error.message });
  }
}

module.exports = {
  createExam,
  getAllExams,
  getExamDetails,
  updateExam,
  deleteExam,
  publishExam,
  completeExam,
  getExamsByCourse,
  getActiveExams,
  getExamSchedule
};
