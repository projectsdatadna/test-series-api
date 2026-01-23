require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const { JWSauthenticate } = require("../../components/JWTtoken");

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const COURSES_TABLE = process.env.COURSES_TABLE || 'TestCourses';
const USERS_TABLE = process.env.USERS_TABLE || 'TestUsers';
const STANDARDS_TABLE = process.env.STANDARDS_TABLE || 'TestStandards';
const SUBJECTS_TABLE = process.env.SUBJECTS_TABLE || 'TestSubjects';
const CHAPTERS_TABLE = process.env.CHAPTERS_TABLE || 'TestChapters';
const SECTIONS_TABLE = process.env.SECTIONS_TABLE || 'TestSections';
const SYLLABUS_TABLE = process.env.SYLLABUS_TABLE || 'TestSyllabus';
const MATERIALS_TABLE = process.env.MATERIALS_TABLE || 'TestLearningMaterials';
const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || 'TestAuditLogs';

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

// Helper function to create audit log
const createAuditLog = async (userId, action, details, event) => {
  try {
    const logId = uuidv4();
    const ipAddress = event?.headers?.['X-Forwarded-For'] || 
                     event?.headers?.['x-forwarded-for'] || 
                     'Unknown';

    await dynamoDB.put({
      TableName: AUDIT_LOGS_TABLE,
      Item: {
        log_id: logId,
        user_id: userId,
        action: action,
        module: 'Course',
        details: details,
        ip_address: ipAddress,
        status: 'success',
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
      }
    }).promise();
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
};

// 1. Create Course
async function createCourse(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const {
      name,
      description,
      standardId,
      subjectIds,
      bundleId,
      duration,
      difficultyLevel,
      instructorId,
      chapterId,
      sectionId,
      materialId,
      syllabusId,
      createdBy,
      status = 'active'
    } = JSON.parse(event.body);

    // Validation
    if (!name) {
      return createResponse(400, {
        success: false,
        message: 'name is required'
      });
    }

    if (!createdBy) {
      return createResponse(400, {
        success: false,
        message: 'createdBy is required'
      });
    }

    // Validate difficulty level
    const validDifficulty = ['basic', 'intermediate', 'advanced'];
    if (difficultyLevel && !validDifficulty.includes(difficultyLevel.toLowerCase())) {
      return createResponse(400, {
        success: false,
        message: `Invalid difficulty level. Must be one of: ${validDifficulty.join(', ')}`
      });
    }

    // Validate status
    const validStatuses = ['active', 'inactive', 'archived'];
    if (!validStatuses.includes(status.toLowerCase())) {
      return createResponse(400, {
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const courseId = uuidv4();
    const timestamp = new Date().toISOString();

    const course = {
      course_id: courseId,
      name: name,
      description: description || null,
      standard_id: standardId || null,
      subject_ids: subjectIds || [],
      bundle_id: bundleId || null,
      duration: duration || null,
      difficulty_level: difficultyLevel ? difficultyLevel.toLowerCase() : null,
      instructor_id: instructorId || null,
      status: status.toLowerCase(),
      created_by: createdBy,
      chapter_id: chapterId || null,
      section_id: sectionId || null,
      material_id: materialId || null,
      syllabus_id: syllabusId || null,
      enrollment_count: 0,
      material_count: 0,
      created_at: timestamp,
      updated_at: timestamp
    };

    await dynamoDB.put({
      TableName: COURSES_TABLE,
      Item: course
    }).promise();

    // Create audit log
    await createAuditLog(
      createdBy,
      'create',
      {
        courseId: courseId,
        courseName: name,
        standardId: standardId,
        syllabusId: syllabusId
      },
      event
    );

    return createResponse(201, {
      success: true,
      message: 'Course created successfully',
      data: course
    });

  } catch (error) {
    console.error('CreateCourse Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to create course',
      error: error.message
    });
  }
}

// 2. Get All Courses
async function getAllCourses(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const status = queryParams.status;
    const difficultyLevel = queryParams.difficultyLevel;
    const standardId = queryParams.standardId;
    const syllabusId = queryParams.syllabusId;

    let params = {
      TableName: COURSES_TABLE,
      Limit: limit
    };

    // Build filter expression
    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = status.toLowerCase();
    }

    if (difficultyLevel) {
      filterExpressions.push('difficulty_level = :difficulty');
      expressionAttributeValues[':difficulty'] = difficultyLevel.toLowerCase();
    }

    if (standardId) {
      filterExpressions.push('standard_id = :standardId');
      expressionAttributeValues[':standardId'] = standardId;
    }

    if (syllabusId) {
      filterExpressions.push('syllabus_id = :syllabusId');
      expressionAttributeValues[':syllabusId'] = syllabusId;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.scan(params).promise();

    const response = {
      success: true,
      data: result.Items,
      count: result.Items.length
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetAllCourses Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve courses',
      error: error.message
    });
  }
}

// 3. Get Course Details
async function getCourseDetails(event) {
  try {
    const courseId = event.pathParameters?.courseId;

    if (!courseId) {
      return createResponse(400, {
        success: false,
        message: 'courseId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: COURSES_TABLE,
      Key: { course_id: courseId }
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'Course not found'
      });
    }

    const course = result.Item;

    // Get related data
    const enrichedCourse = { ...course };

    // Get instructor details
    if (course.instructor_id) {
      try {
        const instructorResult = await dynamoDB.get({
          TableName: USERS_TABLE,
          Key: { user_id: course.instructor_id }
        }).promise();

        enrichedCourse.instructor = instructorResult.Item ? {
          userId: instructorResult.Item.user_id,
          fullName: instructorResult.Item.full_name,
          email: instructorResult.Item.email
        } : null;
      } catch (err) {
        console.error('Error fetching instructor:', err);
      }
    }

    // Get standard details
    if (course.standard_id) {
      try {
        const standardResult = await dynamoDB.get({
          TableName: STANDARDS_TABLE,
          Key: { standard_id: course.standard_id }
        }).promise();

        enrichedCourse.standard = standardResult.Item || null;
      } catch (err) {
        console.error('Error fetching standard:', err);
      }
    }

    // Get syllabus details
    if (course.syllabus_id) {
      try {
        const syllabusResult = await dynamoDB.get({
          TableName: SYLLABUS_TABLE,
          Key: { syllabus_id: course.syllabus_id }
        }).promise();

        enrichedCourse.syllabus = syllabusResult.Item || null;
      } catch (err) {
        console.error('Error fetching syllabus:', err);
      }
    }

    // Get subjects details
    if (course.subject_ids && course.subject_ids.length > 0) {
      try {
        const subjectPromises = course.subject_ids.map(subjectId =>
          dynamoDB.get({
            TableName: SUBJECTS_TABLE,
            Key: { subject_id: subjectId }
          }).promise()
        );

        const subjectResults = await Promise.all(subjectPromises);
        enrichedCourse.subjects = subjectResults
          .filter(r => r.Item)
          .map(r => r.Item);
      } catch (err) {
        console.error('Error fetching subjects:', err);
      }
    }

    return createResponse(200, {
      success: true,
      data: enrichedCourse
    });

  } catch (error) {
    console.error('GetCourseDetails Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve course details',
      error: error.message
    });
  }
}

// 4. Update Course
async function updateCourse(event) {
  try {
    const courseId = event.pathParameters?.courseId;

    if (!courseId) {
      return createResponse(400, {
        success: false,
        message: 'courseId is required'
      });
    }

    const updates = JSON.parse(event.body);

    // Check if course exists
    const existingCourse = await dynamoDB.get({
      TableName: COURSES_TABLE,
      Key: { course_id: courseId }
    }).promise();

    if (!existingCourse.Item) {
      return createResponse(404, {
        success: false,
        message: 'Course not found'
      });
    }

    // Fields that can be updated
    const allowedFields = [
      'name', 'description', 'standard_id', 'subject_ids', 'bundle_id',
      'duration', 'difficulty_level', 'instructor_id', 'status',
      'chapter_id', 'section_id', 'material_id', 'syllabus_id'
    ];

    // Build update expression
    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeNames = {};
    const expressionAttributeValues = {
      ':updated_at': new Date().toISOString()
    };

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        
        // Handle lowercase for specific fields
        if (key === 'difficulty_level' || key === 'status') {
          expressionAttributeValues[`:${key}`] = updates[key].toLowerCase();
        } else {
          expressionAttributeValues[`:${key}`] = updates[key];
        }
      }
    });

    const params = {
      TableName: COURSES_TABLE,
      Key: { course_id: courseId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    // Create audit log
    await createAuditLog(
      updates.userId || 'system',
      'update',
      {
        courseId: courseId,
        updatedFields: Object.keys(updates)
      },
      event
    );

    return createResponse(200, {
      success: true,
      message: 'Course updated successfully',
      data: result.Attributes
    });

  } catch (error) {
    console.error('UpdateCourse Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to update course',
      error: error.message
    });
  }
}

// 5. Delete / Archive Course
async function deleteCourse(event) {
  try {
    const courseId = event.pathParameters?.courseId;
    const permanent = event.queryStringParameters?.permanent === 'true';

    if (!courseId) {
      return createResponse(400, {
        success: false,
        message: 'courseId is required'
      });
    }

    // Check if course exists
    const existingCourse = await dynamoDB.get({
      TableName: COURSES_TABLE,
      Key: { course_id: courseId }
    }).promise();

    if (!existingCourse.Item) {
      return createResponse(404, {
        success: false,
        message: 'Course not found'
      });
    }

    if (permanent) {
      // Permanent deletion
      await dynamoDB.delete({
        TableName: COURSES_TABLE,
        Key: { course_id: courseId }
      }).promise();

      return createResponse(200, {
        success: true,
        message: 'Course permanently deleted'
      });
    } else {
      // Archive course
      await dynamoDB.update({
        TableName: COURSES_TABLE,
        Key: { course_id: courseId },
        UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'archived',
          ':updated_at': new Date().toISOString()
        }
      }).promise();

      return createResponse(200, {
        success: true,
        message: 'Course archived successfully'
      });
    }

  } catch (error) {
    console.error('DeleteCourse Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to delete course',
      error: error.message
    });
  }
}

// 6. Assign Instructor
async function assignInstructor(event) {
  try {
    const courseId = event.pathParameters?.courseId;

    if (!courseId) {
      return createResponse(400, {
        success: false,
        message: 'courseId is required'
      });
    }

    const { instructorId } = JSON.parse(event.body);

    if (!instructorId) {
      return createResponse(400, {
        success: false,
        message: 'instructorId is required'
      });
    }

    // Verify instructor exists
    const instructorResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: instructorId }
    }).promise();

    if (!instructorResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'Instructor not found'
      });
    }

    // Update course
    const result = await dynamoDB.update({
      TableName: COURSES_TABLE,
      Key: { course_id: courseId },
      UpdateExpression: 'SET instructor_id = :instructorId, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':instructorId': instructorId,
        ':updated_at': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Instructor assigned successfully',
      data: {
        courseId: courseId,
        instructorId: instructorId,
        instructor: {
          userId: instructorResult.Item.user_id,
          fullName: instructorResult.Item.full_name,
          email: instructorResult.Item.email
        }
      }
    });

  } catch (error) {
    console.error('AssignInstructor Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to assign instructor',
      error: error.message
    });
  }
}

// 7. Get Course Materials
async function getCourseMaterials(event) {
  try {
    const courseId = event.pathParameters?.courseId;

    if (!courseId) {
      return createResponse(400, {
        success: false,
        message: 'courseId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    // Query materials by course_id
    const params = {
      TableName: MATERIALS_TABLE,
      IndexName: 'courseId-index',
      KeyConditionExpression: 'course_id = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      },
      Limit: limit
    };

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    const response = {
      success: true,
      data: {
        courseId: courseId,
        materials: result.Items,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetCourseMaterials Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve course materials',
      error: error.message
    });
  }
}

// 8. Get Course Structure (Full Hierarchy)
async function getCourseStructure(event) {
  try {
    const courseId = event.pathParameters?.courseId;

    if (!courseId) {
      return createResponse(400, {
        success: false,
        message: 'courseId is required'
      });
    }

    // Get course details
    const courseResult = await dynamoDB.get({
      TableName: COURSES_TABLE,
      Key: { course_id: courseId }
    }).promise();

    if (!courseResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'Course not found'
      });
    }

    const course = courseResult.Item;
    const structure = {
      course: course,
      syllabus: null,
      standard: null,
      subjects: []
    };

    // Get syllabus
    if (course.syllabus_id) {
      const syllabusResult = await dynamoDB.get({
        TableName: SYLLABUS_TABLE,
        Key: { syllabus_id: course.syllabus_id }
      }).promise();
      structure.syllabus = syllabusResult.Item || null;
    }

    // Get standard
    if (course.standard_id) {
      const standardResult = await dynamoDB.get({
        TableName: STANDARDS_TABLE,
        Key: { standard_id: course.standard_id }
      }).promise();
      structure.standard = standardResult.Item || null;
    }

    // Get subjects with chapters and sections
    if (course.subject_ids && course.subject_ids.length > 0) {
      for (const subjectId of course.subject_ids) {
        const subjectResult = await dynamoDB.get({
          TableName: SUBJECTS_TABLE,
          Key: { subject_id: subjectId }
        }).promise();

        if (subjectResult.Item) {
          const subject = { ...subjectResult.Item, chapters: [] };

          // Get chapters for this subject
          const chaptersResult = await dynamoDB.query({
            TableName: CHAPTERS_TABLE,
            IndexName: 'subjectId-index',
            KeyConditionExpression: 'subject_id = :subjectId',
            ExpressionAttributeValues: {
              ':subjectId': subjectId
            }
          }).promise();

          // Get sections for each chapter
          for (const chapter of chaptersResult.Items) {
            const chapterWithSections = { ...chapter, sections: [] };

            const sectionsResult = await dynamoDB.query({
              TableName: SECTIONS_TABLE,
              IndexName: 'chapterId-index',
              KeyConditionExpression: 'chapter_id = :chapterId',
              ExpressionAttributeValues: {
                ':chapterId': chapter.chapter_id
              }
            }).promise();

            chapterWithSections.sections = sectionsResult.Items;
            subject.chapters.push(chapterWithSections);
          }

          structure.subjects.push(subject);
        }
      }
    }

    return createResponse(200, {
      success: true,
      data: structure
    });

  } catch (error) {
    console.error('GetCourseStructure Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve course structure',
      error: error.message
    });
  }
}

// 9. Get Courses by Standard
async function getCoursesByStandard(event) {
  try {
    const standardId = event.pathParameters?.standardId;

    if (!standardId) {
      return createResponse(400, {
        success: false,
        message: 'standardId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const status = queryParams.status;

    let params = {
      TableName: COURSES_TABLE,
      IndexName: 'standardId-index',
      KeyConditionExpression: 'standard_id = :standardId',
      ExpressionAttributeValues: {
        ':standardId': standardId
      },
      Limit: limit
    };

    // Filter by status if provided
    if (status) {
      params.FilterExpression = '#status = :status';
      params.ExpressionAttributeNames = { '#status': 'status' };
      params.ExpressionAttributeValues[':status'] = status.toLowerCase();
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    const response = {
      success: true,
      data: {
        standardId: standardId,
        courses: result.Items,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetCoursesByStandard Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve courses by standard',
      error: error.message
    });
  }
}

// 10. Get Courses by Subject
async function getCoursesBySubject(event) {
  try {
    const subjectId = event.pathParameters?.subjectId;

    if (!subjectId) {
      return createResponse(400, {
        success: false,
        message: 'subjectId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    // Scan courses and filter by subject_ids containing this subjectId
    const params = {
      TableName: COURSES_TABLE,
      FilterExpression: 'contains(subject_ids, :subjectId)',
      ExpressionAttributeValues: {
        ':subjectId': subjectId
      },
      Limit: limit
    };

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.scan(params).promise();

    const response = {
      success: true,
      data: {
        subjectId: subjectId,
        courses: result.Items,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetCoursesBySubject Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve courses by subject',
      error: error.message
    });
  }
}

// 11. Get Courses by Syllabus
async function getCoursesBySyllabus(event) {
  try {
    const syllabusId = event.pathParameters?.syllabusId;

    if (!syllabusId) {
      return createResponse(400, {
        success: false,
        message: 'syllabusId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;

    const params = {
      TableName: COURSES_TABLE,
      IndexName: 'syllabusId-index',
      KeyConditionExpression: 'syllabus_id = :syllabusId',
      ExpressionAttributeValues: {
        ':syllabusId': syllabusId
      },
      Limit: limit
    };

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    const response = {
      success: true,
      data: {
        syllabusId: syllabusId,
        courses: result.Items,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetCoursesBySyllabus Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve courses by syllabus',
      error: error.message
    });
  }
}

module.exports = {
  createCourse: JWSauthenticate(createCourse),
  getAllCourses: JWSauthenticate(getAllCourses),
  getCourseDetails: JWSauthenticate(getCourseDetails),
  updateCourse: JWSauthenticate(updateCourse),
  deleteCourse: JWSauthenticate(deleteCourse),
  assignInstructor: JWSauthenticate(assignInstructor),
  getCourseMaterials: JWSauthenticate(getCourseDetails),
  getCourseStructure: JWSauthenticate(getCourseStructure),
  getCoursesByStandard: JWSauthenticate(getCoursesByStandard),
  getCoursesBySubject: JWSauthenticate(getCoursesBySubject),
  getCoursesBySyllabus: JWSauthenticate(getCoursesBySyllabus)
};
