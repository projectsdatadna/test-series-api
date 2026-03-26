const axios = require('axios');

/**
 * Call Firebase API to split book into sections using Claude
 * This calls the synchronous endpoint that processes and returns sections
 *
 * @param {string} text - The extracted PDF text
 * @param {string} chapterName - Name of the chapter
 * @param {object} metadata - Additional metadata (subjectId, standardId, etc.)
 * @returns {Promise<Array>} Array of sections with sectionNumber, title, and content
 */
async function splitBookWithClaude(text, chapterName, metadata = {}) {
  try {
    // Use environment variable for Firebase API URL
    const firebaseApiUrl = process.env.FIREBASE_API_URL || 'http://localhost:5001/drivingschool-630d9/us-central1/api';

    console.log('\n========== CLAUDE API SPLITTING START ==========');
    console.log('[RAG] claudeSplitter - Calling Firebase API for Claude-based splitting');
    console.log('[RAG] Firebase API URL:', firebaseApiUrl);
    console.log('[RAG] Endpoint:', `${firebaseApiUrl}/book-upload/split-sections`);
    console.log('[RAG] Text length:', text.length, 'characters');
    console.log('[RAG] Chapter name:', chapterName);
    console.log('[RAG] Metadata:', JSON.stringify(metadata, null, 2));

    const payload = {
      text: text,
      chapterName: chapterName,
      metadata: {
        subjectId: metadata.subjectId,
        standardId: metadata.standardId,
        syllabusId: metadata.syllabusId,
        bookType: metadata.bookType
      }
    };

    console.log('[RAG] Request payload size:', JSON.stringify(payload).length, 'bytes');
    console.log('[RAG] Sending request to Firebase API...');
    console.log('[RAG] Timeout: 5 minutes (300000ms)');

    const startTime = Date.now();

    const response = await axios.post(`${firebaseApiUrl}/book-upload/split-sections`, payload, {
      timeout: 300000, // 5 minutes timeout for Claude processing
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const elapsedTime = Date.now() - startTime;
    console.log('[RAG] Firebase API response received in', elapsedTime, 'ms');
    console.log('[RAG] Response status:', response.status);
    console.log('[RAG] Response data keys:', Object.keys(response.data));

    if (!response.data || !response.data.success) {
      console.error('[RAG] Firebase API returned error:', response.data?.error || 'Unknown error');
      throw new Error(response.data?.error || 'Firebase API returned error');
    }

    const sections = response.data.sections || [];

    console.log('[RAG] claudeSplitter - Successfully split into ' + sections.length + ' sections');
    console.log('[RAG] Sections breakdown:');
    sections.forEach((s, idx) => {
      console.log(`[RAG]   [${idx + 1}/${sections.length}] ${s.sectionNumber}: "${s.sectionTitle || s.title || '(no title)'}" (${(s.content?.length || 0)} chars)`);
    });

    // Normalize section format to match existing structure
    const normalizedSections = sections.map(s => ({
      sectionNumber: s.sectionNumber,
      title: s.sectionTitle || s.title || s.sectionNumber,
      content: s.content || '',
      sectionType: s.sectionType || 'content'
    }));

    console.log('[RAG] Normalized sections for storage');
    console.log('========== CLAUDE API SPLITTING SUCCESS ==========\n');

    return normalizedSections;

  } catch (error) {
    console.error('\n========== CLAUDE API SPLITTING ERROR ==========');
    console.error('[RAG] Error in claudeSplitter:', error.message);
    console.error('[RAG] Error code:', error.code);
    console.error('[RAG] Error response status:', error.response?.status);
    console.error('[RAG] Error response data:', error.response?.data);
    console.error('[RAG] Stack trace:', error.stack);
    console.error('========== CLAUDE API SPLITTING FAILED ==========\n');
    throw error;
  }
}

module.exports = {
  splitBookWithClaude
};
