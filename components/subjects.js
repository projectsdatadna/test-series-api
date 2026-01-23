const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const SUBJECTS_TABLE = process.env.SUBJECTS_TABLE || 'TestSubjects';
const CHAPTERS_TABLE = process.env.CHAPTERS_TABLE || 'TestChapters';
const COURSES_TABLE = process.env.COURSES_TABLE || 'TestCourses';

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

// 1. Create Subject
async function createSubject(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const {
      name,
      standardId,
      courseId,
      code = null,
      description = null,
      status = 'active'
    } = JSON.parse(event.body);

    if (!name) return createResponse(400, { success: false, message: 'name is required' });
    if (!standardId && !courseId) return createResponse(400, { success: false, message: 'Either standardId or courseId is required' });

    const now = new Date().toISOString();
    const subjectId = uuidv4();

    const item = {
      subject_id: subjectId,
      name,
      standard_id: standardId || null,
      course_id: courseId || null,
      code,
      description,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: SUBJECTS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Subject created successfully', data: item });

  } catch (error) {
    console.error('CreateSubject Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create subject', error: error.message });
  }
}

// 2. Get All Subjects (filter by standardId or courseId)
async function getAllSubjects(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const standardId = queryParams.standardId;
    const courseId = queryParams.courseId;

    let params = {
      TableName: SUBJECTS_TABLE,
      Limit: limit
    };

    if (standardId) {
      params.IndexName = 'standardId-index'; // GSI on standard_id
      params.KeyConditionExpression = 'standard_id = :standardId';
      params.ExpressionAttributeValues = { ':standardId': standardId };
    } else if (courseId) {
      params.IndexName = 'courseId-index'; // GSI on course_id
      params.KeyConditionExpression = 'course_id = :courseId';
      params.ExpressionAttributeValues = { ':courseId': courseId };
    } else {
      // No filter, do scan (less efficient)
    }

    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(queryParams.lastKey, 'base64').toString());
    }

    const result = (params.KeyConditionExpression)
      ? await dynamoDB.query(params).promise()
      : await dynamoDB.scan(params).promise();

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
    console.error('GetAllSubjects Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve subjects', error: error.message });
  }
}

// 3. Get Subject Details (with chapters)
async function getSubjectDetails(event) {
  try {
    const subjectId = event.pathParameters?.subjectId;
    if (!subjectId) return createResponse(400, { success: false, message: 'subjectId is required' });

    const subjectResult = await dynamoDB.get({
      TableName: SUBJECTS_TABLE,
      Key: { subject_id: subjectId }
    }).promise();

    if (!subjectResult.Item) return createResponse(404, { success: false, message: 'Subject not found' });

    // Get chapters linked to subject
    const chaptersResult = await dynamoDB.query({
      TableName: CHAPTERS_TABLE,
      IndexName: 'subjectId-index',
      KeyConditionExpression: 'subject_id = :subjectId',
      ExpressionAttributeValues: { ':subjectId': subjectId }
    }).promise();

    const subject = {
      ...subjectResult.Item,
      chapters: chaptersResult.Items || []
    };

    return createResponse(200, { success: true, data: subject });

  } catch (error) {
    console.error('GetSubjectDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve subject details', error: error.message });
  }
}

// 4. Update Subject
async function updateSubject(event) {
  try {
    const subjectId = event.pathParameters?.subjectId;
    if (!subjectId) return createResponse(400, { success: false, message: 'subjectId is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['name', 'description', 'code', 'status', 'standard_id', 'course_id', 'chapter_id', 'section_id', 'material_id'];

    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updated_at': new Date().toISOString() };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = (key === 'status' && updates[key]) ? updates[key].toLowerCase() : updates[key];
      }
    });

    const params = {
      TableName: SUBJECTS_TABLE,
      Key: { subject_id: subjectId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Subject updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateSubject Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update subject', error: error.message });
  }
}

// 5. Delete Subject (soft delete)
async function deleteSubject(event) {
  try {
    const subjectId = event.pathParameters?.subjectId;
    if (!subjectId) return createResponse(400, { success: false, message: 'subjectId is required' });

    const params = {
      TableName: SUBJECTS_TABLE,
      Key: { subject_id: subjectId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'archived', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Subject archived successfully', data: result.Attributes });

  } catch (error) {
    console.error('DeleteSubject Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete subject', error: error.message });
  }
}

// 6. Get Subject Chapters
async function getSubjectChapters(event) {
  try {
    const subjectId = event.pathParameters?.subjectId;
    if (!subjectId) return createResponse(400, { success: false, message: 'subjectId is required' });

    const params = {
      TableName: CHAPTERS_TABLE,
      IndexName: 'subjectId-index',
      KeyConditionExpression: 'subject_id = :subjectId',
      ExpressionAttributeValues: { ':subjectId': subjectId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items });

  } catch (error) {
    console.error('GetSubjectChapters Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve subject chapters', error: error.message });
  }
}

// 7. Link Subject to Course
async function linkSubjectToCourse(event) {
  try {
    const courseId = event.pathParameters?.courseId;
    if (!courseId) return createResponse(400, { success: false, message: 'courseId is required' });

    const { subjectId } = JSON.parse(event.body);
    if (!subjectId) return createResponse(400, { success: false, message: 'subjectId is required' });

    // Verify course exists
    const courseResult = await dynamoDB.get({
      TableName: COURSES_TABLE,
      Key: { course_id: courseId }
    }).promise();

    if (!courseResult.Item) {
      return createResponse(404, { success: false, message: 'Course not found' });
    }

    // Update Subject record to link it to course
    const params = {
      TableName: SUBJECTS_TABLE,
      Key: { subject_id: subjectId },
      UpdateExpression: 'SET course_id = :courseId, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':courseId': courseId,
        ':updated_at': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Subject linked to course successfully', data: result.Attributes });

  } catch (error) {
    console.error('LinkSubjectToCourse Error:', error);
    return createResponse(500, { success: false, message: 'Failed to link subject to course', error: error.message });
  }
}

module.exports = {
  createSubject,
  getAllSubjects,
  getSubjectDetails,
  updateSubject,
  deleteSubject,
  getSubjectChapters,
  linkSubjectToCourse
};
