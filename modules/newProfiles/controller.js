require('dotenv').config();
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

AWS.config.update({ region: process.env.AWS_REGION || 'ap-south-1' });

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const s3       = new AWS.S3();

const USER_PROFILES_TABLE = process.env.USER_PROFILES_TABLE || 'UserProfiles';
const USERS_TABLE         = process.env.USERS_TABLE         || 'Users';
const S3_BUCKET           = process.env.PROFILE_PICS_BUCKET || 'profile-pics-bucket';

const headers = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,PUT,DELETE',
};

const createResponse = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const isValidDate = (d) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return re.test(d) && !isNaN(new Date(d));
};

const calculateAge = (dob) => {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

const getProfileByUserId = async (userId) => {
  const result = await dynamoDB.query({
    TableName: USER_PROFILES_TABLE,
    IndexName: 'userId-index',
    KeyConditionExpression: 'user_id = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }).promise();
  return result.Items?.[0] || null;
};

// ─── 1. Create Profile ────────────────────────────────────────
const createProfile = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    const {
      userId, email, username, phone, dob, address, gender, bio,
      userType,
      schoolName, schoolAddress, schoolLocation, standard,
      collegeName, collegeAddress, collegeLocation, degree,
      governmentExam,
    } = body;

   if (!userId) return createResponse(400, { success: false, message: 'userId is required' });
if (!email && !body.phone) return createResponse(400, { success: false, message: 'email or phone is required' });

    const existing = await getProfileByUserId(userId);
    const timestamp = new Date().toISOString();

    const profileData = {
      user_id:         userId,
      email,
      username:        username        || null,
      phone:           phone           || null,
      dob:             dob             || null,
      address:         address         || null,
      gender:          gender          || null,
      bio:             bio             || null,
      userType:        userType        || null,
      schoolName:      schoolName      || null,
      schoolAddress:   schoolAddress   || null,
      schoolLocation:  schoolLocation  || null,
      standard:        standard        || null,
      collegeName:     collegeName     || null,
      collegeAddress:  collegeAddress  || null,
      collegeLocation: collegeLocation || null,
      degree:          degree          || null,
      governmentExam:  governmentExam  || null,
      updated_at:      timestamp,
    };

    if (dob) profileData.age = calculateAge(dob);

    if (existing) {
      // Update existing profile
      let updateExpr = 'SET updated_at = :updated_at';
      const exprValues = { ':updated_at': timestamp };
      const exprNames  = {};

      Object.entries(profileData).forEach(([key, val]) => {
        if (key !== 'user_id' && val !== null && val !== undefined) {
          updateExpr += `, #${key} = :${key}`;
          exprValues[`:${key}`] = val;
          exprNames[`#${key}`]  = key;
        }
      });

      await dynamoDB.update({
        TableName: USER_PROFILES_TABLE,
        Key: { profile_id: existing.profile_id },
        UpdateExpression: updateExpr,
        ExpressionAttributeNames:  exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
      }).promise();

      const updated = await dynamoDB.get({
        TableName: USER_PROFILES_TABLE,
        Key: { profile_id: existing.profile_id },
      }).promise();

      return createResponse(200, { success: true, message: 'Profile updated', data: updated.Item });
    } else {
      // Create new profile
      const item = {
        profile_id: uuidv4(),
        ...profileData,
        created_at: timestamp,
      };
      await dynamoDB.put({ TableName: USER_PROFILES_TABLE, Item: item }).promise();
      return createResponse(201, { success: true, message: 'Profile created', data: item });
    }
  } catch (err) {
    console.error('[createProfile]', err);
    return createResponse(500, { success: false, message: 'Failed to save profile', error: err.message });
  }
};

// ─── 2. Get All Profiles ──────────────────────────────────────
const getAllProfiles = async (event) => {
  try {
    const result = await dynamoDB.scan({ TableName: USER_PROFILES_TABLE }).promise();
    return createResponse(200, { success: true, data: result.Items, count: result.Count });
  } catch (err) {
    console.error('[getAllProfiles]', err);
    return createResponse(500, { success: false, message: 'Failed to fetch profiles', error: err.message });
  }
};

// ─── 3. Get Profile by User ID ────────────────────────────────
const getProfile = async (event) => {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    const profile = await getProfileByUserId(userId);
    if (!profile) return createResponse(404, { success: false, message: 'Profile not found' });

    // Optionally fetch user record
    let userRecord = null;
    try {
      const u = await dynamoDB.get({ TableName: USERS_TABLE, Key: { user_id: userId } }).promise();
      if (u.Item) {
        userRecord = {
          email:    u.Item.email,
          fullName: u.Item.full_name || u.Item.name || u.Item.username,
          status:   u.Item.status,
          roleId:   u.Item.role_id,
        };
      }
    } catch (e) { console.warn('[getProfile] Could not fetch user record:', e.message); }

    return createResponse(200, { success: true, data: { ...profile, user: userRecord } });
  } catch (err) {
    console.error('[getProfile]', err);
    return createResponse(500, { success: false, message: 'Failed to get profile', error: err.message });
  }
};

// ─── 4. Get Profile by Profile ID ────────────────────────────
const getProfileById = async (event) => {
  try {
    const profileId = event.pathParameters?.profileId;
    if (!profileId) return createResponse(400, { success: false, message: 'profileId is required' });

    const result = await dynamoDB.get({ TableName: USER_PROFILES_TABLE, Key: { profile_id: profileId } }).promise();
    if (!result.Item) return createResponse(404, { success: false, message: 'Profile not found' });

    return createResponse(200, { success: true, data: result.Item });
  } catch (err) {
    console.error('[getProfileById]', err);
    return createResponse(500, { success: false, message: 'Failed to get profile', error: err.message });
  }
};

// ─── 5. Update Profile ────────────────────────────────────────
const updateProfile = async (event) => {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    const updates = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    const ALLOWED = [
      'username', 'name', 'email', 'phone', 'address', 'dob', 'gender', 'bio',
      'profile_pic_url', 'userType',
      'schoolName', 'schoolAddress', 'schoolLocation', 'standard',
      'collegeName', 'collegeAddress', 'collegeLocation', 'degree',
      'governmentExam',
    ];

    const filtered = {};
    ALLOWED.forEach(k => { if (updates[k] !== undefined) filtered[k] = updates[k]; });

    if (Object.keys(filtered).length === 0)
      return createResponse(400, { success: false, message: 'At least one field is required' });

    if (filtered.dob && !isValidDate(filtered.dob))
      return createResponse(400, { success: false, message: 'Invalid date. Use YYYY-MM-DD' });

    if (filtered.gender && !['male','female','other'].includes(filtered.gender.toLowerCase()))
      return createResponse(400, { success: false, message: 'Invalid gender' });

    if (filtered.userType && !['school','college','student','bachelor'].includes(filtered.userType.toLowerCase()))
      return createResponse(400, { success: false, message: 'Invalid userType' });

    const timestamp = new Date().toISOString();
    let existing = await getProfileByUserId(userId);

    let profileId;
    if (existing) {
      profileId = existing.profile_id;
    } else {
      profileId = uuidv4();
      await dynamoDB.put({
        TableName: USER_PROFILES_TABLE,
        Item: { profile_id: profileId, user_id: userId, created_at: timestamp, updated_at: timestamp },
      }).promise();
    }

    let updateExpr = 'SET updated_at = :updated_at, user_id = :user_id';
    const exprNames  = {};
    const exprValues = { ':updated_at': timestamp, ':user_id': userId };

    Object.entries(filtered).forEach(([key, val]) => {
      updateExpr += `, #${key} = :${key}`;
      exprNames[`#${key}`]  = key;
      exprValues[`:${key}`] = (key === 'gender' || key === 'userType') ? val.toLowerCase() : val;
    });

    if (filtered.dob) {
      updateExpr += ', age = :age';
      exprValues[':age'] = calculateAge(filtered.dob);
    }

    const result = await dynamoDB.update({
      TableName: USER_PROFILES_TABLE,
      Key: { profile_id: profileId },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames:  exprNames,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }).promise();

    return createResponse(200, { success: true, message: 'Profile saved', data: result.Attributes });
  } catch (err) {
    console.error('[updateProfile]', err);
    return createResponse(500, { success: false, message: 'Failed to update profile', error: err.message });
  }
};

// ─── 6. Delete Profile ────────────────────────────────────────
const deleteProfile = async (event) => {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    const profile = await getProfileByUserId(userId);
    if (!profile) return createResponse(404, { success: false, message: 'Profile not found' });

    await dynamoDB.delete({
      TableName: USER_PROFILES_TABLE,
      Key: { profile_id: profile.profile_id },
    }).promise();

    if (profile.profile_pic_url) {
      try {
        const key = profile.profile_pic_url.split('/').pop();
        await s3.deleteObject({ Bucket: S3_BUCKET, Key: `profile-pics/${key}` }).promise();
      } catch (e) { console.warn('[deleteProfile] S3 cleanup failed:', e.message); }
    }

    return createResponse(200, { success: true, message: 'Profile deleted' });
  } catch (err) {
    console.error('[deleteProfile]', err);
    return createResponse(500, { success: false, message: 'Failed to delete profile', error: err.message });
  }
};

// ─── 7. Upload Profile Picture ────────────────────────────────
const uploadProfilePicture = async (event) => {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { imageData, fileExtension = 'jpg' } = body;
    if (!imageData) return createResponse(400, { success: false, message: 'imageData (base64) is required' });

    const profile = await getProfileByUserId(userId);
    if (!profile) return createResponse(404, { success: false, message: 'Profile not found' });

    // Delete old pic if exists
    if (profile.profile_pic_url) {
      try {
        const oldKey = profile.profile_pic_url.split('/').pop();
        await s3.deleteObject({ Bucket: S3_BUCKET, Key: `profile-pics/${oldKey}` }).promise();
      } catch (e) {}
    }

    const fileName = `${userId}-${Date.now()}.${fileExtension}`;
    const s3Key    = `profile-pics/${fileName}`;

    await s3.putObject({
      Bucket:      S3_BUCKET,
      Key:         s3Key,
      Body:        Buffer.from(imageData, 'base64'),
      ContentType: `image/${fileExtension}`,
      ACL:         'public-read',
    }).promise();

    const profilePicUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    await dynamoDB.update({
      TableName: USER_PROFILES_TABLE,
      Key: { profile_id: profile.profile_id },
      UpdateExpression: 'SET profile_pic_url = :url, updated_at = :ts',
      ExpressionAttributeValues: { ':url': profilePicUrl, ':ts': new Date().toISOString() },
    }).promise();

    return createResponse(200, { success: true, message: 'Profile picture uploaded', data: { profilePicUrl } });
  } catch (err) {
    console.error('[uploadProfilePicture]', err);
    return createResponse(500, { success: false, message: 'Upload failed', error: err.message });
  }
};

// ─── 8. Delete Profile Picture ────────────────────────────────
const deleteProfilePicture = async (event) => {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    const profile = await getProfileByUserId(userId);
    if (!profile) return createResponse(404, { success: false, message: 'Profile not found' });
    if (!profile.profile_pic_url) return createResponse(400, { success: false, message: 'No profile picture to delete' });

    const key = profile.profile_pic_url.split('/').pop();
    await s3.deleteObject({ Bucket: S3_BUCKET, Key: `profile-pics/${key}` }).promise();

    await dynamoDB.update({
      TableName: USER_PROFILES_TABLE,
      Key: { profile_id: profile.profile_id },
      UpdateExpression: 'REMOVE profile_pic_url SET updated_at = :ts',
      ExpressionAttributeValues: { ':ts': new Date().toISOString() },
    }).promise();

    return createResponse(200, { success: true, message: 'Profile picture deleted' });
  } catch (err) {
    console.error('[deleteProfilePicture]', err);
    return createResponse(500, { success: false, message: 'Delete failed', error: err.message });
  }
};

// ─── 9. Profile Statistics ────────────────────────────────────
const getProfileStatistics = async (event) => {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    const profile = await getProfileByUserId(userId);
    if (!profile) return createResponse(404, { success: false, message: 'Profile not found' });

    const FIELDS = ['phone','dob','address','gender','bio','userType','profile_pic_url'];
    const filled = FIELDS.filter(f => profile[f]).length;

    return createResponse(200, {
      success: true,
      data: {
        completionPercentage: Math.round((filled / FIELDS.length) * 100),
        hasProfilePicture:    !!profile.profile_pic_url,
        fieldsCompleted:      filled,
        totalFields:          FIELDS.length,
        userType:             profile.userType || null,
        createdAt:            profile.created_at,
        updatedAt:            profile.updated_at,
      },
    });
  } catch (err) {
    console.error('[getProfileStatistics]', err);
    return createResponse(500, { success: false, message: 'Failed to fetch statistics', error: err.message });
  }
};

module.exports = {
  createProfile,
  getAllProfiles,
  getProfile,
  getProfileById,
  updateProfile,
  deleteProfile,
  uploadProfilePicture,
  deleteProfilePicture,
  getProfileStatistics,
};