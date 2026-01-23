const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const ASSIGNMENTS_TABLE = process.env.ASSIGNMENTS_TABLE || 'TestCourseAssignments';
const MATERIALS_TABLE = process.env.MATERIALS_TABLE || 'TestLearningMaterials';

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

// 1. Create Assignment
async function createAssignment(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const {
      courseId,
      title,
      description = null,
      dueDate,
      totalMarks,
      createdBy,
      status = 'active',
      materialId = null,
      standardId = null,
      subjectId = null,
      chapterId = null,
      sectionId = null,
      url = null,
      language = null,
      ttsAvailable = false,
      aiTutorEnabled = false
    } = JSON.parse(event.body);

    if (!courseId) return createResponse(400, { success: false, message: 'courseId is required' });
    if (!title) return createResponse(400, { success: false, message: 'title is required' });
    if (!dueDate) return createResponse(400, { success: false, message: 'dueDate is required' });
    if (!totalMarks && totalMarks !== 0) return createResponse(400, { success: false, message: 'totalMarks is required' });
    if (!createdBy) return createResponse(400, { success: false, message: 'createdBy is required' });

    const now = new Date().toISOString();
    const assignmentId = uuidv4();

    const item = {
      assignment_id: assignmentId,
      course_id: courseId,
      title,
      description,
      due_date: dueDate,
      total_marks: totalMarks,
      created_by: createdBy,
      status: status.toLowerCase(),
      material_id: materialId,
      standard_id: standardId,
      subject_id: subjectId,
      chapter_id: chapterId,
      section_id: sectionId,
      url,
      language,
      tts_available: ttsAvailable,
      ai_tutor_enabled: aiTutorEnabled,
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: ASSIGNMENTS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Assignment created successfully', data: item });

  } catch (error) {
    console.error('CreateAssignment Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create assignment', error: error.message });
  }
}

// 2. Get All Assignments (filter by courseId or subjectId)
async function getAllAssignments(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const courseId = queryParams.courseId;
    const subjectId = queryParams.subjectId;

    let params = {
      TableName: ASSIGNMENTS_TABLE,
      Limit: limit
    };

    // DynamoDB does not support multi-attribute queries without GSIs. Assume GSIs exist.
    if (courseId) {
      params.IndexName = 'courseId-index'; // Ensure this GSI exists
      params.KeyConditionExpression = 'course_id = :courseId';
      params.ExpressionAttributeValues = { ':courseId': courseId };
    } else if (subjectId) {
      params.IndexName = 'subjectId-index'; // Ensure this GSI exists
      params.KeyConditionExpression = 'subject_id = :subjectId';
      params.ExpressionAttributeValues = { ':subjectId': subjectId };
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
    console.error('GetAllAssignments Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve assignments', error: error.message });
  }
}

// 3. Get Assignment Details
async function getAssignmentDetails(event) {
  try {
    const assignmentId = event.pathParameters?.assignmentId;
    if (!assignmentId) return createResponse(400, { success: false, message: 'assignmentId is required' });

    const result = await dynamoDB.get({
      TableName: ASSIGNMENTS_TABLE,
      Key: { assignment_id: assignmentId }
    }).promise();

    if (!result.Item) return createResponse(404, { success: false, message: 'Assignment not found' });

    return createResponse(200, { success: true, data: result.Item });

  } catch (error) {
    console.error('GetAssignmentDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve assignment details', error: error.message });
  }
}

// 4. Update Assignment
async function updateAssignment(event) {
  try {
    const assignmentId = event.pathParameters?.assignmentId;
    if (!assignmentId) return createResponse(400, { success: false, message: 'assignmentId is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['title', 'description', 'due_date', 'total_marks', 'status', 'material_id', 'standard_id', 'subject_id', 'chapter_id', 'section_id', 'url', 'language', 'tts_available', 'ai_tutor_enabled'];

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

    if (Object.keys(expressionAttributeNames).length === 0) {
      return createResponse(400, { success: false, message: 'No valid fields to update' });
    }

    const params = {
      TableName: ASSIGNMENTS_TABLE,
      Key: { assignment_id: assignmentId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Assignment updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateAssignment Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update assignment', error: error.message });
  }
}

// 5. Delete Assignment (soft delete)
async function deleteAssignment(event) {
  try {
    const assignmentId = event.pathParameters?.assignmentId;
    if (!assignmentId) return createResponse(400, { success: false, message: 'assignmentId is required' });

    const params = {
      TableName: ASSIGNMENTS_TABLE,
      Key: { assignment_id: assignmentId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Assignment marked inactive', data: result.Attributes });

  } catch (error) {
    console.error('DeleteAssignment Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete assignment', error: error.message });
  }
}

// 6. Get Assignment Materials
async function getAssignmentMaterials(event) {
  try {
    const assignmentId = event.pathParameters?.assignmentId;
    if (!assignmentId) return createResponse(400, { success: false, message: 'assignmentId is required' });

    const assignmentResult = await dynamoDB.get({
      TableName: ASSIGNMENTS_TABLE,
      Key: { assignment_id: assignmentId }
    }).promise();

    if (!assignmentResult.Item) return createResponse(404, { success: false, message: 'Assignment not found' });

    const materialId = assignmentResult.Item.material_id;
    if (!materialId) return createResponse(200, { success: true, data: [] });

    const materialResult = await dynamoDB.get({
      TableName: MATERIALS_TABLE,
      Key: { material_id: materialId }
    }).promise();

    return createResponse(200, { success: true, data: materialResult.Item ? [materialResult.Item] : [] });

  } catch (error) {
    console.error('GetAssignmentMaterials Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve assignment materials', error: error.message });
  }
}

module.exports = {
  createAssignment,
  getAllAssignments,
  getAssignmentDetails,
  updateAssignment,
  deleteAssignment,
  getAssignmentMaterials
};
