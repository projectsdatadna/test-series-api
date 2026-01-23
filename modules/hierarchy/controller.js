require('dotenv').config();
const AWS = require("aws-sdk");

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const COURSES_TABLE = process.env.COURSES_TABLE || 'Courses';
const STANDARDS_TABLE = process.env.STANDARDS_TABLE || 'Standards';
const SUBJECTS_TABLE = process.env.SUBJECTS_TABLE || 'Subjects';
const CHAPTERS_TABLE = process.env.CHAPTERS_TABLE || 'Chapters';
const SECTIONS_TABLE = process.env.SECTIONS_TABLE || 'Sections';
const SYLLABUS_TABLE = process.env.SYLLABUS_TABLE || 'Syllabus';

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
  "Access-Control-Allow-Credentials": true
};

const createResponse = (statusCode, body) => {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
};

// 1. Link Syllabus to Course
async function linkSyllabusToCourse(event) {
  try {
    const syllabusId = event.pathParameters?.syllabusId;
    const courseId = event.pathParameters?.courseId;

    if (!syllabusId || !courseId) {
      return createResponse(400, {
        success: false,
        message: 'syllabusId and courseId are required'
      });
    }

    // Verify syllabus exists
    const syllabusResult = await dynamoDB.get({
      TableName: SYLLABUS_TABLE,
      Key: { syllabus_id: syllabusId }
    }).promise();

    if (!syllabusResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'Syllabus not found'
      });
    }

    // Update course with syllabus_id
    await dynamoDB.update({
      TableName: COURSES_TABLE,
      Key: { course_id: courseId },
      UpdateExpression: 'SET syllabus_id = :syllabusId, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':syllabusId': syllabusId,
        ':updated_at': new Date().toISOString()
      }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Syllabus linked to course successfully',
      data: {
        syllabusId: syllabusId,
        courseId: courseId
      }
    });

  } catch (error) {
    console.error('LinkSyllabusToCourse Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to link syllabus to course',
      error: error.message
    });
  }
}

// 2. Link Standard to Course
async function linkStandardToCourse(event) {
  try {
    const standardId = event.pathParameters?.standardId;
    const courseId = event.pathParameters?.courseId;

    if (!standardId || !courseId) {
      return createResponse(400, {
        success: false,
        message: 'standardId and courseId are required'
      });
    }

    // Verify standard exists
    const standardResult = await dynamoDB.get({
      TableName: STANDARDS_TABLE,
      Key: { standard_id: standardId }
    }).promise();

    if (!standardResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'Standard not found'
      });
    }

    // Update course with standard_id
    await dynamoDB.update({
      TableName: COURSES_TABLE,
      Key: { course_id: courseId },
      UpdateExpression: 'SET standard_id = :standardId, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':standardId': standardId,
        ':updated_at': new Date().toISOString()
      }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Standard linked to course successfully',
      data: {
        standardId: standardId,
        courseId: courseId
      }
    });

  } catch (error) {
    console.error('LinkStandardToCourse Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to link standard to course',
      error: error.message
    });
  }
}

// 3. Link Subject to Standard
async function linkSubjectToStandard(event) {
  try {
    const standardId = event.pathParameters?.standardId;
    const subjectId = event.pathParameters?.subjectId;

    if (!standardId || !subjectId) {
      return createResponse(400, {
        success: false,
        message: 'standardId and subjectId are required'
      });
    }

    // Update subject with standard_id
    await dynamoDB.update({
      TableName: SUBJECTS_TABLE,
      Key: { subject_id: subjectId },
      UpdateExpression: 'SET standard_id = :standardId, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':standardId': standardId,
        ':updated_at': new Date().toISOString()
      }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Subject linked to standard successfully',
      data: {
        standardId: standardId,
        subjectId: subjectId
      }
    });

  } catch (error) {
    console.error('LinkSubjectToStandard Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to link subject to standard',
      error: error.message
    });
  }
}

// 4. Link Chapter to Subject
async function linkChapterToSubject(event) {
  try {
    const subjectId = event.pathParameters?.subjectId;
    const chapterId = event.pathParameters?.chapterId;

    if (!subjectId || !chapterId) {
      return createResponse(400, {
        success: false,
        message: 'subjectId and chapterId are required'
      });
    }

    // Update chapter with subject_id
    await dynamoDB.update({
      TableName: CHAPTERS_TABLE,
      Key: { chapter_id: chapterId },
      UpdateExpression: 'SET subject_id = :subjectId, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':subjectId': subjectId,
        ':updated_at': new Date().toISOString()
      }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Chapter linked to subject successfully',
      data: {
        subjectId: subjectId,
        chapterId: chapterId
      }
    });

  } catch (error) {
    console.error('LinkChapterToSubject Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to link chapter to subject',
      error: error.message
    });
  }
}

// 5. Link Section to Chapter
async function linkSectionToChapter(event) {
  try {
    const chapterId = event.pathParameters?.chapterId;
    const sectionId = event.pathParameters?.sectionId;

    if (!chapterId || !sectionId) {
      return createResponse(400, {
        success: false,
        message: 'chapterId and sectionId are required'
      });
    }

    // Update section with chapter_id
    await dynamoDB.update({
      TableName: SECTIONS_TABLE,
      Key: { section_id: sectionId },
      UpdateExpression: 'SET chapter_id = :chapterId, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':chapterId': chapterId,
        ':updated_at': new Date().toISOString()
      }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Section linked to chapter successfully',
      data: {
        chapterId: chapterId,
        sectionId: sectionId
      }
    });

  } catch (error) {
    console.error('LinkSectionToChapter Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to link section to chapter',
      error: error.message
    });
  }
}

// 6. Link Syllabus to Subject
async function linkSyllabusToSubject(event) {
  try {
    const syllabusId = event.pathParameters?.syllabusId;
    const subjectId = event.pathParameters?.subjectId;

    if (!syllabusId || !subjectId) {
      return createResponse(400, {
        success: false,
        message: 'syllabusId and subjectId are required'
      });
    }

    // Update subject with syllabus_id
    await dynamoDB.update({
      TableName: SUBJECTS_TABLE,
      Key: { subject_id: subjectId },
      UpdateExpression: 'SET syllabus_id = :syllabusId, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':syllabusId': syllabusId,
        ':updated_at': new Date().toISOString()
      }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Syllabus linked to subject successfully',
      data: {
        syllabusId: syllabusId,
        subjectId: subjectId
      }
    });

  } catch (error) {
    console.error('LinkSyllabusToSubject Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to link syllabus to subject',
      error: error.message
    });
  }
}

module.exports = {
  linkSyllabusToCourse,
  linkStandardToCourse,
  linkSubjectToStandard,
  linkChapterToSubject,
  linkSectionToChapter,
  linkSyllabusToSubject
};
