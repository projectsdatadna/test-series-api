const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const CHAPTERS_TABLE = process.env.CHAPTERS_TABLE || 'TestChapters';
const SECTIONS_TABLE = process.env.SECTIONS_TABLE || 'TestSections';

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

// 1. Create Chapter
async function createChapter(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, { success: false, message: 'Request body is required' });
    }

    const {
      name,
      subjectId,
      description = null,
      orderIndex = 0,
      materialId = null,
      courseId = null,
      sectionId = null,
      standardId = null,
      status = 'active'
    } = JSON.parse(event.body);

    // Validate required fields
    if (!name) return createResponse(400, { success: false, message: 'name is required' });
    if (!subjectId) return createResponse(400, { success: false, message: 'subjectId is required' });

    const now = new Date().toISOString();
    const chapterId = uuidv4();

    const item = {
      chapter_id: chapterId,
      name,
      subject_id: subjectId,
      description,
      order_index: orderIndex,
      material_id: materialId,
      course_id: courseId,
      section_id: sectionId,
      standard_id: standardId,
      status: status.toLowerCase(),
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({
      TableName: CHAPTERS_TABLE,
      Item: item
    }).promise();

    return createResponse(201, { success: true, message: 'Chapter created successfully', data: item });

  } catch (error) {
    console.error('CreateChapter Error:', error);
    return createResponse(500, { success: false, message: 'Failed to create chapter', error: error.message });
  }
}

// 2. Get All Chapters (optional subjectId filter)
async function getAllChapters(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const subjectId = queryParams.subjectId;

    let params = {
      TableName: CHAPTERS_TABLE,
      Limit: limit
    };

    if (subjectId) {
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
    console.error('GetAllChapters Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve chapters', error: error.message });
  }
}

// 3. Get Chapter Details (with Sections)
async function getChapterDetails(event) {
  try {
    const chapterId = event.pathParameters?.chapterId;
    if (!chapterId) return createResponse(400, { success: false, message: 'chapterId is required' });

    const chapterResult = await dynamoDB.get({
      TableName: CHAPTERS_TABLE,
      Key: { chapter_id: chapterId }
    }).promise();

    if (!chapterResult.Item) return createResponse(404, { success: false, message: 'Chapter not found' });

    // Get sections under this chapter
    const sectionsResult = await dynamoDB.query({
      TableName: SECTIONS_TABLE,
      IndexName: 'chapterId-index',
      KeyConditionExpression: 'chapter_id = :chapterId',
      ExpressionAttributeValues: { ':chapterId': chapterId }
    }).promise();

    const chapter = {
      ...chapterResult.Item,
      sections: sectionsResult.Items || []
    };

    return createResponse(200, { success: true, data: chapter });

  } catch (error) {
    console.error('GetChapterDetails Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve chapter details', error: error.message });
  }
}

// 4. Update Chapter
async function updateChapter(event) {
  try {
    const chapterId = event.pathParameters?.chapterId;
    if (!chapterId) return createResponse(400, { success: false, message: 'chapterId is required' });

    const updates = JSON.parse(event.body);

    const allowedFields = ['name', 'description', 'order_index', 'material_id', 'course_id', 'section_id', 'standard_id', 'status', 'subject_id'];

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
      TableName: CHAPTERS_TABLE,
      Key: { chapter_id: chapterId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Chapter updated successfully', data: result.Attributes });

  } catch (error) {
    console.error('UpdateChapter Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update chapter', error: error.message });
  }
}

// 5. Delete Chapter (soft delete)
async function deleteChapter(event) {
  try {
    const chapterId = event.pathParameters?.chapterId;
    if (!chapterId) return createResponse(400, { success: false, message: 'chapterId is required' });

    const params = {
      TableName: CHAPTERS_TABLE,
      Key: { chapter_id: chapterId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'archived', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Chapter archived successfully', data: result.Attributes });

  } catch (error) {
    console.error('DeleteChapter Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete chapter', error: error.message });
  }
}

// 6. Get Chapter Sections
async function getChapterSections(event) {
  try {
    const chapterId = event.pathParameters?.chapterId;
    if (!chapterId) return createResponse(400, { success: false, message: 'chapterId is required' });

    const params = {
      TableName: SECTIONS_TABLE,
      IndexName: 'chapterId-index',
      KeyConditionExpression: 'chapter_id = :chapterId',
      ExpressionAttributeValues: { ':chapterId': chapterId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items });

  } catch (error) {
    console.error('GetChapterSections Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve chapter sections', error: error.message });
  }
}

// 7. Get Chapters by Subject
async function getChaptersBySubject(event) {
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
    console.error('GetChaptersBySubject Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve chapters by subject', error: error.message });
  }
}

module.exports = {
  createChapter,
  getAllChapters,
  getChapterDetails,
  updateChapter,
  deleteChapter,
  getChapterSections,
  getChaptersBySubject
};
