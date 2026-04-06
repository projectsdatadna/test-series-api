const axios = require('axios');
const { splitByHeadings } = require('./textSplitter');

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
    // Guard: if text is empty or too short, throw immediately
    if (!text || text.trim().length < 100) {
      throw new Error('Text is too short or empty for AI-based splitting. The PDF may have font encoding issues that prevent text extraction.');
    }

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

    // Firebase returns section titles only — extract actual content from the original text.
    // Strategy: use the sectionNumbers (e.g. "5.1", "5.2") returned by Firebase as regex
    // anchors to find exact positions in the PDF text, then assign Claude's titles.
    // This is more reliable than heading search since section numbers are unambiguous.
    const titlesOnly = sections.every(s => !s.content || s.content.trim().length === 0);

    let normalizedSections;

    if (titlesOnly) {
      console.log('[RAG] Firebase returned titles only — extracting content using section number anchors');

      // Normalize line endings
      const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Check if sections have decimal section numbers (e.g. "5.1", "5.2")
      const hasDecimalNumbers = sections.some(s => s.sectionNumber && /^\d+\.\d+/.test(s.sectionNumber));

      if (hasDecimalNumbers) {
        // Find each section number's position in the text
        const anchors = [];
        for (const s of sections) {
          const sectionNumber = s.sectionNumber;
          if (!sectionNumber) continue;

          // Match the section number at the start of a line (e.g. "5.1 ..." or "5.1\n")
          const escapedNum = sectionNumber.replace('.', '\\.');
          const numRegex = new RegExp(`(?:^|\\n)\\s*${escapedNum}(?:\\s|\\n)`, 'g');
          let match;
          let bestMatch = null;

          while ((match = numRegex.exec(normalizedText)) !== null) {
            // Prefer the first occurrence that isn't in the table of contents
            // (TOC entries are usually in the first 10% of the text)
            const isLikelyTOC = match.index < normalizedText.length * 0.1;
            if (!bestMatch || (!isLikelyTOC && bestMatch.index < normalizedText.length * 0.1)) {
              bestMatch = match;
            }
          }

          if (bestMatch) {
            anchors.push({
              sectionNumber,
              title: s.sectionTitle || s.title || sectionNumber,
              index: bestMatch.index,
              headerEnd: bestMatch.index + bestMatch[0].length
            });
            console.log(`[RAG] Found section ${sectionNumber} at index ${bestMatch.index}`);
          } else {
            console.warn(`[RAG] Section number ${sectionNumber} not found in text`);
          }
        }

        // Sort by position in text
        anchors.sort((a, b) => a.index - b.index);

        // Extract content between anchors
        normalizedSections = anchors.map((anchor, idx) => {
          const contentStart = anchor.headerEnd;
          const contentEnd = idx < anchors.length - 1 ? anchors[idx + 1].index : normalizedText.length;
          const content = normalizedText.substring(contentStart, contentEnd).trim();

          console.log(`[RAG] Section ${anchor.sectionNumber} "${anchor.title}": ${content.length} chars`);
          return {
            sectionNumber: anchor.sectionNumber,
            title: anchor.title,
            content,
            sectionType: 'content'
          };
        });
      } else {
        // No decimal section numbers — fall back to heading-based extraction
        console.log('[RAG] No decimal section numbers — falling back to splitByHeadings');
        const sectionTitles = sections.map(s => s.sectionTitle || s.title || '').filter(Boolean);
        const headingSections = splitByHeadings(text, sectionTitles);
        normalizedSections = headingSections.map((s, idx) => ({
          sectionNumber: sections[idx]?.sectionNumber || s.sectionNumber,
          title: sections[idx]?.sectionTitle || sections[idx]?.title || s.sectionTitle || s.title,
          content: s.content || '',
          sectionType: 'content'
        }));
      }

      console.log('[RAG] Content extracted:');
      normalizedSections.forEach((s, idx) => {
        console.log(`[RAG]   [${idx + 1}] ${s.sectionNumber}: "${s.title}" (${s.content.length} chars)`);
      });
    } else {
      // Firebase returned content directly — use as-is
      normalizedSections = sections.map(s => ({
        sectionNumber: s.sectionNumber,
        title: s.sectionTitle || s.title || s.sectionNumber,
        content: s.content || '',
        sectionType: s.sectionType || 'content'
      }));
    }

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

/**
 * Split TN State Board book using Claude API
 * Calls Firebase endpoint specifically designed for TN books
 * Handles Unit → Section hierarchy
 *
 * @param {string} text - The extracted PDF text
 * @param {string} chapterName - Name of the book
 * @param {object} metadata - Metadata (subjectId, standardId, syllabusId, term, etc.)
 * @returns {Promise<Array>} Array of sections with sectionNumber, sectionTitle, content, sectionType
 */
async function splitTNBookWithClaude(text, chapterName, metadata = {}) {
  try {
    const firebaseApiUrl = process.env.FIREBASE_API_URL || 'http://localhost:5001/drivingschool-630d9/us-central1/api';

    console.log('\n========== CLAUDE API - TN STATE BOARD SPLITTING START ==========');
    console.log('[RAG] splitTNBookWithClaude - Calling Firebase API for TN book splitting');
    console.log('[RAG] Firebase API URL:', firebaseApiUrl);
    console.log('[RAG] Endpoint:', `${firebaseApiUrl}/book-upload/split-tn-sections`);
    console.log('[RAG] Text length:', text.length, 'characters');
    console.log('[RAG] Book name:', chapterName);
    console.log('[RAG] Subject:', metadata.subjectId);
    console.log('[RAG] Standard:', metadata.standardId);
    console.log('[RAG] Syllabus:', metadata.syllabusId);
    if (metadata.term) {
      console.log('[RAG] Term:', metadata.term);
    }

    const payload = {
      text: text,
      chapterName: chapterName,
      metadata: {
        subjectId: metadata.subjectId,
        standardId: metadata.standardId,
        syllabusId: metadata.syllabusId,
        bookType: metadata.bookType,
        division: metadata.division,
        term: metadata.term
      }
    };

    console.log('[RAG] Request payload size:', JSON.stringify(payload).length, 'bytes');
    console.log('[RAG] Text encoding: UTF-8');
    console.log('[RAG] Sending request to Firebase API...');
    console.log('[RAG] Timeout: 10 minutes (600000ms)');

    const startTime = Date.now();

    const response = await axios.post(
      `${firebaseApiUrl}/book-upload/split-tn-sections`,
      payload,
      {
        timeout: 600000, // 10 minutes timeout for Claude processing
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const elapsedTime = Date.now() - startTime;
    console.log('[RAG] Firebase API response received in', elapsedTime, 'ms');
    console.log('[RAG] Response status:', response.status);
    console.log('[RAG] Response data keys:', Object.keys(response.data));

    if (!response.data || !response.data.success) {
      console.error('[RAG] Firebase API returned error:', response.data?.error || 'Unknown error');
      console.error('[RAG] Full response:', JSON.stringify(response.data, null, 2));
      throw new Error(response.data?.error || 'Firebase API returned error');
    }

    const sections = response.data.sections || [];

    console.log('[RAG] splitTNBookWithClaude - Successfully split into ' + sections.length + ' sections');
    console.log('[RAG] Sections breakdown:');
    sections.forEach((s, idx) => {
      console.log(`[RAG]   [${idx + 1}/${sections.length}] ${s.sectionNumber}: "${s.sectionTitle}" (${(s.content?.length || 0)} chars, type: ${s.sectionType})`);
    });

    console.log('========== CLAUDE API - TN STATE BOARD SPLITTING SUCCESS ==========\n');

    return sections;

  } catch (error) {
    console.error('\n========== CLAUDE API - TN STATE BOARD SPLITTING ERROR ==========');
    console.error('[RAG] Error in splitTNBookWithClaude:', error.message);
    console.error('[RAG] Error code:', error.code);
    console.error('[RAG] Error response status:', error.response?.status);
    console.error('[RAG] Error response data:', JSON.stringify(error.response?.data, null, 2));
    console.error('[RAG] Error config:', {
      url: error.config?.url,
      method: error.config?.method,
      dataLength: error.config?.data?.length
    });
    console.error('[RAG] Stack trace:', error.stack);
    console.error('========== CLAUDE API - TN STATE BOARD SPLITTING FAILED ==========\n');
    throw error;
  }
}

module.exports = {
  splitBookWithClaude,
  splitTNBookWithClaude
};
