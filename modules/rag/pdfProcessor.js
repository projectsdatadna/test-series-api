/**
 * PDF Processor Service
 * Extracts text from PDF, splits into sections, generates embeddings, and stores in sections table
 */

const pdfParse = require('pdf-parse');
const { generateEmbeddings } = require('./embeddings');
const { processSectionsToChunks } = require('./textSplitter');
const { storeSectionWithEmbeddings } = require('./sectionStore');

/**
 * Extract text from PDF buffer with proper encoding handling
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPDF(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    let text = data.text;

    // Ensure proper UTF-8 encoding
    if (Buffer.isBuffer(text)) {
      text = text.toString('utf8');
    }

    // Remove control characters but preserve Unicode
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    console.log('[RAG] Extracted text length:', text.length);
    console.log('[RAG] First 300 chars sample:', text.substring(0, 300));

    // Check if text contains Hindi characters (Devanagari Unicode range: U+0900 to U+097F)
    const devanagariRegex = /[\u0900-\u097F]/g;
    const hindiMatches = text.match(devanagariRegex);
    if (hindiMatches) {
      console.log('[RAG] Detected Hindi text - found', hindiMatches.length, 'Devanagari characters');
    } else {
      console.warn('[RAG] WARNING: No Devanagari characters detected. Text may be in font encoding (Kruti Dev, Mangal, etc.)');
      console.warn('[RAG] This PDF may require font encoding conversion. Consider using Claude API for better handling.');
    }

    return text;
  } catch (error) {
    console.error('[RAG] Error extracting text from PDF:', error.message);
    throw error;
  }
}

/**
 * Process PDF and store sections with embeddings
 * Ensures NO content is lost during processing
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {Object} metadata - Metadata for sections
 * @returns {Promise<Array>} Stored sections
 */
async function processPDFToSections(pdfBuffer, metadata = {}) {
  try {
    const {
      chapterId,
      documentId,
      chapterName,
      syllabusId,
      standardId,
      subjectId,
      division,
      bookType,
      pageRanges,
      splitPattern = 'regex_based',
      sectionTitles,
      isTNStateBoard = false,
      term,
      unitSectionTitles,
      // College-specific fields
      isCollegeEducation = false,
      departmentId,
      semesterId,
      subject,
      sectionTitle
    } = metadata;

    // Convert term format from "Term I" to "TERM_1" for database storage
    const convertTermFormat = (termStr) => {
      if (!termStr) return null;
      const termMap = {
        'Term I': 'TERM_1',
        'Term II': 'TERM_2',
        'Term III': 'TERM_3'
      };
      return termMap[termStr] || termStr;
    };

    const dbTerm = convertTermFormat(term);

    console.log('[RAG] processPDFToSections - START with metadata:', {
      chapterId,
      documentId,
      syllabusId,
      standardId,
      subjectId,
      division,
      bookType,
      splitPattern,
      isTNStateBoard,
      term,
      isCollegeEducation,
      departmentId,
      semesterId,
      subject,
      sectionTitle
    });

    if (!chapterId) {
      throw new Error('chapterId is required in metadata');
    }

    // Extract text from PDF
    const text = await extractTextFromPDF(pdfBuffer);

    // Split into sections based on the specified pattern
    let sections;

    // Check if this is TN State Board book - use specialized splitting
    if (isTNStateBoard) {
      console.log('[RAG] processPDFToSections - Detected TN State Board book');
      console.log('[RAG] processPDFToSections - Subject:', subjectId);
      console.log('[RAG] processPDFToSections - Standard:', standardId);
      console.log('[RAG] processPDFToSections - Division from request:', division);
      if (term) {
        console.log(`[RAG] processPDFToSections - Processing ${term}`);
      }
      
      // Normalize standardId to handle both STD_8 and STD_8_TN formats
      const normalizeStandardId = (id) => {
        if (!id) return id;
        return String(id).replace(/_TN$/, '');
      };
      const normalizedStandardId = normalizeStandardId(standardId);
      console.log('[RAG] processPDFToSections - Normalized standardId:', normalizedStandardId);
      
      // Check if this is a Science or Social Science book - use Claude API
      const isScienceOrSocialScience = subjectId && 
        (subjectId.includes('SCI') || subjectId.includes('Science') || 
         subjectId.includes('SS') || subjectId.includes('SOC') || subjectId.includes('Social'));
      
      const isValidStandard = normalizedStandardId && 
        (normalizedStandardId === 'STD_8' || normalizedStandardId === 'STD_9' || normalizedStandardId === 'STD_10' || 
         normalizedStandardId === '8' || normalizedStandardId === '9' || normalizedStandardId === '10');
      
      console.log('[RAG] processPDFToSections - isScienceOrSocialScience:', isScienceOrSocialScience);
      console.log('[RAG] processPDFToSections - isValidStandard:', isValidStandard);
      
      // Use Claude API for TN Science/Social Science books (Std 8, 9, 10)
      if (isScienceOrSocialScience && isValidStandard) {
        console.log('[RAG] processPDFToSections - Using Claude API for TN Science/Social Science book');
        try {
          const { splitTNBookWithClaude } = require('./claudeSplitter');
          console.log('[RAG] processPDFToSections - Calling splitTNBookWithClaude...');
          sections = await splitTNBookWithClaude(text, chapterName, {
            subjectId,
            standardId: normalizedStandardId,
            syllabusId,
            bookType,
            division,
            term
          });
          console.log(`[RAG] processPDFToSections - Claude API returned ${sections.length} sections`);
          
          // Normalize section format
          sections = sections.map(s => ({
            sectionNumber: s.sectionNumber,
            sectionTitle: s.sectionTitle || s.title,
            sectionType: s.sectionType || 'content',
            content: s.content
          }));
          
          console.log('[RAG] processPDFToSections - Proceeding to chunk processing with Claude API sections');
          
          // Step 1: Extract unique units from sections
          const unitMap = {};
          
          sections.forEach(section => {
            const sectionNum = section.sectionNumber;
            const unitMatch = sectionNum.match(/^(\d+)/);
            
            if (unitMatch) {
              const unitNum = parseInt(unitMatch[1]);
              
              // Extract unit
              if (!unitMap[unitNum]) {
                let unitTitle = `Unit ${unitNum}`;
                if ((section.sectionNumber === `${unitNum}.0` || section.sectionNumber === `${unitNum}`) && section.sectionTitle) {
                  unitTitle = section.sectionTitle;
                }
                unitMap[unitNum] = {
                  unitNumber: unitNum,
                  unitTitle: unitTitle
                };
              }
            }
          });
          
          const units = Object.values(unitMap).sort((a, b) => a.unitNumber - b.unitNumber);
          
          console.log(`[RAG] Extracted ${units.length} units from Claude API sections`);
          console.log('[RAG] Units:', units.map(u => ({
            unitNumber: u.unitNumber,
            unitTitle: u.unitTitle
          })));
          
          // Step 2: Create unit chapters (division is passed from request, not created here)
          const hierarchyService = require('../file-hierarchy/service');
          const unitChapters = [];
          
          for (const unit of units) {
            try {
              const unitChapterName = unit.unitTitle;
              const unitDocumentId = documentId || chapterId;
              
              const unitChapterData = await hierarchyService.createChapter(
                subjectId,
                unitChapterName,
                `${unitDocumentId}_unit_${unit.unitNumber}`,
                syllabusId,
                normalizedStandardId,
                division || null,
                dbTerm
              );
              
              unitChapters.push({
                unitNumber: unit.unitNumber,
                chapterId: unitChapterData.chapterId,
                chapterName: unitChapterName
              });
              
              console.log(`[RAG] Created unit chapter: "${unitChapterName}" (${unitChapterData.chapterId})`);
            } catch (e) {
              console.warn(`[RAG] Could not create unit chapter for Unit ${unit.unitNumber}:`, e.message);
              unitChapters.push({
                unitNumber: unit.unitNumber,
                chapterId: `${documentId}_unit_${unit.unitNumber}`,
                chapterName: unit.unitTitle
              });
            }
          }
          
          // Step 3: Update chapterId for sections based on their unit
          sections = sections.map(section => {
            const unitMatch = section.sectionNumber.match(/^(\d+)/);
            if (unitMatch) {
              const unitNum = parseInt(unitMatch[1]);
              const unitChapter = unitChapters.find(uc => uc.unitNumber === unitNum);
              if (unitChapter) {
                return {
                  ...section,
                  chapterId: unitChapter.chapterId,
                  division: division || null
                };
              }
            }
            return section;
          });
          
          console.log('[RAG] Updated sections with unit chapter IDs and division from request');
        } catch (claudeError) {
          console.error('[RAG] processPDFToSections - Claude API failed:', claudeError.message);
          throw claudeError; // Fail fast, don't fallback
        }
      } else {
        // For other TN subjects (Math, English), use regex-based splitting
        console.log('[RAG] processPDFToSections - Using regex-based splitting for TN State Board book');
        const { splitByUnits, splitBySections } = require('./tnBoardSplitter');

      // Step 1: Split by units
      let units = splitByUnits(text);
      console.log(`[RAG] TN Board splitter returned ${units.length} units`);

      // If unitSectionTitles provided, ensure we have units for all provided titles
      if (unitSectionTitles && Array.isArray(unitSectionTitles) && unitSectionTitles.length > 0) {
        console.log(`[RAG] Custom unit section titles provided for ${unitSectionTitles.length} units`);

        // Check if we need to create additional units
        const maxProvidedUnit = Math.max(...unitSectionTitles.map(u => u.unitNumber));
        const maxDetectedUnit = units.length > 0 ? Math.max(...units.map(u => u.unitNumber)) : 0;

        if (maxProvidedUnit > maxDetectedUnit) {
          console.log(`[RAG] Need to create ${maxProvidedUnit - maxDetectedUnit} additional units based on unitSectionTitles`);

          const lines = text.split('\n');

          // Find where the last detected unit starts in the original text
          let lastUnitStartLine = 0;
          if (units.length > 0) {
            const lastUnit = units[units.length - 1];
            // Find the start of the last unit's content
            const textBeforeLastUnit = text.substring(0, text.indexOf(lastUnit.content));
            lastUnitStartLine = textBeforeLastUnit.split('\n').length;
          }

          // Get all content from the start of the last detected unit to the end
          const linesInThisSection = lines.slice(lastUnitStartLine);

          // Remove the last detected unit from our units array (we'll re-add it with correct boundaries)
          if (units.length > 0) {
            units.pop();
          }

          // Split the content equally among all units in this section
          const totalUnitsInThisSection = (maxProvidedUnit - maxDetectedUnit) + 1; // +1 for the last detected unit
          const chunkSize = Math.floor(linesInThisSection.length / totalUnitsInThisSection);

          for (let i = 0; i < totalUnitsInThisSection; i++) {
            const unitNum = maxDetectedUnit + i;
            const startLine = i * chunkSize;
            const endLine = i === totalUnitsInThisSection - 1 ? linesInThisSection.length : (i + 1) * chunkSize;

            const unitContent = linesInThisSection.slice(startLine, endLine).join('\n').trim();

            units.push({
              unitNumber: unitNum,
              unitTitle: `Unit ${unitNum}`,
              content: unitContent,
              contentLength: unitContent.length
            });

            console.log(`[RAG] Created/Updated Unit ${unitNum}: ${unitContent.length} characters`);
          }

          // Sort units by unit number
          units.sort((a, b) => a.unitNumber - b.unitNumber);
        }
      }

      if (units.length === 0) {
        throw new Error('No units found in TN State Board book');
      }

      // Step 2: Create chapters for each unit
      const hierarchyService = require('../file-hierarchy/service');
      const unitChapters = [];

      for (const unit of units) {
        try {
          const unitChapterName = `Unit ${unit.unitNumber}`;
          const unitDocumentId = documentId || chapterId;

          const unitChapterData = await hierarchyService.createChapter(
            subjectId,
            unitChapterName,
            `${unitDocumentId}_unit_${unit.unitNumber}`,
            syllabusId,
            standardId,
            division || null,
            dbTerm
          );

          unitChapters.push({
            unitNumber: unit.unitNumber,
            chapterId: unitChapterData.chapterId,
            chapterName: unitChapterName
          });

          console.log(`[RAG] Created chapter for Unit ${unit.unitNumber}: ${unitChapterData.chapterId}`);
        } catch (e) {
          console.warn(`[RAG] Could not create chapter for Unit ${unit.unitNumber}:`, e.message);
          // Fallback: use generated ID
          unitChapters.push({
            unitNumber: unit.unitNumber,
            chapterId: `${chapterId}_unit_${unit.unitNumber}`,
            chapterName: `Unit ${unit.unitNumber}`
          });
        }
      }

      // Step 3: Process each unit - split sections and store
      const storedSections = [];

      for (const unit of units) {
        const unitChapter = unitChapters.find(uc => uc.unitNumber === unit.unitNumber);
        const unitChapterId = unitChapter.chapterId;

        console.log(`[RAG] Processing Unit ${unit.unitNumber} with chapterId: ${unitChapterId}`);

        // Check if custom section titles are provided for this unit
        const customTitles = unitSectionTitles?.find(u => u.unitNumber === unit.unitNumber);

        // Split unit content by sections
        let unitSections;
        if (customTitles && customTitles.sections && customTitles.sections.length > 0) {
          console.log(`[RAG] Using custom section titles for Unit ${unit.unitNumber}:`, customTitles.sections);
          // Use custom titles - pass them to the splitter
          unitSections = splitBySections(unit.content, unit.unitNumber, unit.unitTitle, customTitles.sections, subjectId);
        } else {
          // Use automatic detection - pass subjectId for subject-specific logic
          unitSections = splitBySections(unit.content, unit.unitNumber, unit.unitTitle, null, subjectId);
        }
        console.log(`[RAG] Unit ${unit.unitNumber} split into ${unitSections.length} sections`);

        // SPECIAL CASE: If only one section found, use chapter name as section title
        if (unitSections.length === 1) {
          console.log(`[RAG] Only one section found for Unit ${unit.unitNumber}, using chapter name as section title`);
          unitSections[0].sectionTitle = unit.unitTitle;
          console.log(`[RAG] Updated section title to: "${unit.unitTitle}"`);
        }

        // Create chunks for all sections
        const { processSectionsToChunks } = require('./textSplitter');
        const allChunks = await processSectionsToChunks(unitSections);
        console.log(`[RAG] Created ${allChunks.length} chunks from Unit ${unit.unitNumber}`);

        // Generate embeddings for all chunks
        const texts = allChunks.map(chunk => chunk.text);
        const embeddings = await generateEmbeddings(texts);

        // Combine chunks with embeddings
        const chunksWithEmbeddings = allChunks.map((chunk, index) => ({
          ...chunk,
          embedding: embeddings[index]
        }));

        // Group chunks by section
        const sectionMap = {};
        chunksWithEmbeddings.forEach(chunk => {
          if (!sectionMap[chunk.sectionNumber]) {
            sectionMap[chunk.sectionNumber] = {
              sectionNumber: chunk.sectionNumber,
              sectionTitle: chunk.sectionTitle,
              sectionType: chunk.sectionType || null,
              chunks: []
            };
          }
          sectionMap[chunk.sectionNumber].chunks.push(chunk);
        });

        console.log(`[RAG] Section map for Unit ${unit.unitNumber}:`, Object.keys(sectionMap).map(key => ({
          sectionNumber: sectionMap[key].sectionNumber,
          sectionTitle: sectionMap[key].sectionTitle,
          sectionType: sectionMap[key].sectionType,
          chunkCount: sectionMap[key].chunks.length
        })));

        // Store each section in parallel
        const sectionStoragePromises = Object.entries(sectionMap).map(async ([sectionNumber, sectionData]) => {
          try {
            console.log(`[RAG] Storing section ${sectionNumber} in Unit ${unit.unitNumber}`);

            const storedSection = await storeSectionWithEmbeddings({
              chapterId: unitChapterId,
              sectionNumber: sectionData.sectionNumber,
              sectionTitle: sectionData.sectionTitle,
              sectionType: sectionData.sectionType,
              type: null,
              syllabusId,
              standardId,
              subjectId,
              division,
              chunks: sectionData.chunks
            });

            console.log(`[RAG] Stored section ${sectionNumber} with ${sectionData.chunks.length} chunks`);
            return storedSection;
          } catch (sectionError) {
            console.warn(`[RAG] Warning: Could not store section ${sectionNumber}:`, sectionError.message);
            return null;
          }
        });

        // Wait for all sections to be stored
        const storedSectionsForUnit = await Promise.all(sectionStoragePromises);
        storedSections.push(...storedSectionsForUnit.filter(s => s !== null));
      }

      console.log(`[RAG] Successfully stored ${storedSections.length} sections from ${units.length} units`);
      console.log('[RAG] processPDFToSections - Regex-based TN State Board processing complete');
      
      // Return stored sections directly - they've already been processed and stored
      return storedSections;
      }
    } else {
      // Check if user explicitly selected AI-based splitting
      const useAIBased = splitPattern === 'ai_based';

      if (useAIBased) {
        // Use Claude API for AI-based splitting
        const { splitBookWithClaude } = require('./claudeSplitter');

        console.log('\n========== CLAUDE API - AI BASED SPLITTING ==========');
        console.log(`[RAG] Book metadata: ${standardId} ${subjectId} (${syllabusId})`);
        console.log(`[RAG] Using Claude API for book splitting`);
        console.log(`[RAG] Firebase API URL from env: ${process.env.FIREBASE_API_URL || 'NOT SET (using default)'}`);
        console.log(`[RAG] Text to split: ${text.length} characters`);
        console.log(`[RAG] Chapter name: ${chapterName}`);

        try {
          console.log('[RAG] Calling splitBookWithClaude...');
          sections = await splitBookWithClaude(text, chapterName, {
            subjectId,
            standardId,
            syllabusId,
            bookType,
            division
          });
          console.log(`[RAG] Claude API returned ${sections.length} sections`);
        } catch (claudeError) {
          console.warn('\n========== CLAUDE API FAILED ==========');
          console.warn('[RAG] Claude API splitting failed:', claudeError.message);
          console.warn('[RAG] Error details:', {
            code: claudeError.code,
            status: claudeError.response?.status,
            message: claudeError.message
          });
          throw claudeError;
        }

        console.log('[RAG] Splitter returned sections:', sections.map(s => ({
          sectionNumber: s.sectionNumber,
          sectionTitle: s.title || s.sectionTitle,
          contentLength: s.content?.length || 0
        })));

        // Normalize section format
        sections = sections.map(s => ({
          sectionNumber: s.sectionNumber,
          sectionTitle: s.title || s.sectionTitle,
          sectionType: 'content',
          content: s.content
        }));
        console.log('========== CLAUDE API SPLITTING COMPLETE ==========\n');
      } else {
        // Use traditional splitting methods based on splitPattern
        const { splitBySections, splitByChaptersAndSections, splitByManualAnchors, splitByHeadings, splitByPageRanges } = require('./textSplitter');
        const { splitEnglishBook } = require('./englishSplitter');
        const { splitHindiBook, splitHindiBookByHeadings, splitHindiBookWithTitles } = require('./hindiSplitter');

        // Check if this is 9th or 10th English
        const isEnglish9or10 = (standardId === 'STD_9' || standardId === 'STD_10' || standardId === '9' || standardId === '10') &&
                               (subjectId === 'SUB_ENG' || subjectId === 'English');

        console.log('[RAG] processPDFToSections - isEnglish9or10:', isEnglish9or10, 'division:', division, 'bookType:', bookType);

        // For 9th/10th English with heading_based pattern and sectionTitles, use heading-based splitting
        if (isEnglish9or10 && splitPattern === 'heading_based' && sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0) {
          console.log(`[RAG] Using heading_based splitting for ${standardId} ${subjectId} with provided section titles`);
          const headingSections = splitByHeadings(text, sectionTitles);
          sections = headingSections.map(s => ({
            sectionNumber: s.sectionNumber,
            sectionTitle: s.sectionTitle,
            sectionType: 'content',
            content: s.content
          }));
          console.log('[RAG] Heading-based splitter returned sections:', sections.map(s => ({
            sectionNumber: s.sectionNumber,
            sectionTitle: s.sectionTitle,
            contentLength: s.content.length
          })));
        } else if (isEnglish9or10 && division) {
          // Use English-specific splitting
          console.log(`[RAG] Using English-specific splitting for ${standardId} ${subjectId} - ${division}`);
          sections = splitEnglishBook(text, division);
          console.log('[RAG] English splitter returned sections:', sections.map(s => ({
            sectionNumber: s.sectionNumber,
            sectionTitle: s.sectionTitle,
            sectionType: s.sectionType
          })));
        } else if (subjectId === 'SUB_HIN' || subjectId === 'Hindi' || subjectId === 'हिंदी') {
          // Use Hindi-specific splitting
          console.log(`[RAG] Using Hindi-specific splitting for ${standardId} ${subjectId}`);

          if (sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0) {
            console.log(`[RAG] Using custom section titles for Hindi book: ${sectionTitles.length} sections`);
            sections = splitHindiBookWithTitles(text, sectionTitles);
          } else if (syllabusId && syllabusId.toUpperCase().includes('NCERT')) {
            console.log(`[RAG] Detected NCERT Hindi book, using heading-based splitting`);
            sections = splitHindiBookByHeadings(text);
          } else {
            console.log(`[RAG] Using automatic Hindi book splitting`);
            sections = splitHindiBook(text);
          }

          console.log('[RAG] Hindi splitter returned sections:', sections.map(s => ({
            sectionNumber: s.sectionNumber,
            sectionTitle: s.sectionTitle,
            sectionType: s.sectionType,
            wordCount: s.metadata?.wordCount
          })));
        } else if (pageRanges && Array.isArray(pageRanges) && pageRanges.length > 0) {
          // Use page-based splitting if pageRanges provided
          if (splitPattern && splitPattern !== 'regex_based') {
            console.warn(`[RAG] splitPattern '${splitPattern}' is ignored because pageRanges is provided`);
          }
          console.log(`[RAG] Using page_ranges splitting strategy`);
          sections = splitByPageRanges(text, pageRanges);
        } else {
          // Use the specified split pattern
          switch (splitPattern) {
          case 'regex_based':
            console.log(`[RAG] Using regex_based splitting strategy`);
            sections = splitBySections(text);
            break;

          case 'heading_based':
            console.log(`[RAG] Using heading_based splitting strategy`);
            sections = splitByHeadings(text, sectionTitles);
            break;

          case 'chapter_based':
            console.log(`[RAG] Using chapter_based splitting strategy`);
            sections = splitByChaptersAndSections(text);
            break;

          case 'manual_anchors':
            console.log(`[RAG] Using manual_anchors splitting strategy`);
            const defaultAnchors = [
              { title: 'The Day the River Spoke', start: 'The Day the River Spoke' },
              { title: 'Try Again', start: 'Try Again' },
              { title: 'Three Days to See', start: 'Three Days to See' }
            ];
            sections = splitByManualAnchors(text, defaultAnchors);
            break;

          case 'direct_upload':
            console.log(`[RAG] Using direct_upload strategy - no structural splitting, token-based chunking only`);
            // For direct upload, create a single section with the entire text
            // Chunking will be done by token count (~2000 tokens per chunk)
            
            // For college education, use sectionTitle; for school, use chapterName
            const sectionName = isCollegeEducation ? (sectionTitle || chapterName || 'Content') : (chapterName || 'Content');
            
            sections = [{
              sectionNumber: '1',
              title: sectionName,
              sectionTitle: sectionName,
              content: text,
              sectionType: 'content',
              useTokenBasedChunking: true,  // Flag to use token-based chunking
              // College-specific metadata
              isCollegeEducation: isCollegeEducation,
              departmentId: departmentId || null,
              semesterId: semesterId || null,
              subject: subject || null,
              collegeChapterName: chapterName || null
            }];
            
            console.log(`[RAG] Direct upload section created:`, {
              sectionName,
              isCollegeEducation,
              departmentId,
              semesterId,
              subject,
              collegeChapterName: chapterName
            });
            break;

          default:
            console.log(`[RAG] Unknown split pattern '${splitPattern}', defaulting to regex_based`);
            sections = splitBySections(text);
          }
        }
      }
    }

    console.log('[RAG] processPDFToSections - Sections after splitting:', sections.map(s => ({
      sectionNumber: s.sectionNumber,
      sectionTitle: s.title || s.sectionTitle,
      sectionType: s.sectionType
    })));

    // SPECIAL CASE: If only one section found, use chapter name as section title
    // BUT: For college education, keep the sectionTitle as provided
    if (sections.length === 1 && chapterName && !isCollegeEducation) {
      console.log(`[RAG] Only one section found (${sections.length}), chapterName available: "${chapterName}"`);
      console.log(`[RAG] Current section title: "${sections[0].title || sections[0].sectionTitle}"`);

      // Handle both 'title' and 'sectionTitle' properties
      if (sections[0].title !== undefined) {
        sections[0].title = chapterName;
      }
      if (sections[0].sectionTitle !== undefined) {
        sections[0].sectionTitle = chapterName;
      }
      // Set both to ensure it works regardless of property name
      if (!sections[0].title && !sections[0].sectionTitle) {
        sections[0].title = chapterName;
        sections[0].sectionTitle = chapterName;
      }

      console.log(`[RAG] Updated section title to: "${chapterName}"`);
      console.log(`[RAG] Verification - section.title: "${sections[0].title}", section.sectionTitle: "${sections[0].sectionTitle}"`);
    } else if (sections.length === 1) {
      console.log(`[RAG] Only one section found. Current title: "${sections[0].title || sections[0].sectionTitle}"`);
      if (isCollegeEducation) {
        console.log(`[RAG] College education upload - keeping sectionTitle as provided`);
      }
    }

    // Process sections to create chunks
    const { processSectionsToChunks } = require('./textSplitter');
    const allChunks = await processSectionsToChunks(sections);

    console.log('[RAG] processPDFToSections - Chunks after processing:', allChunks.slice(0, 3).map(c => ({
      sectionNumber: c.sectionNumber,
      sectionTitle: c.sectionTitle,
      sectionType: c.sectionType
    })));

    // Generate embeddings for all chunks
    const texts = allChunks.map(chunk => chunk.text);
    const embeddings = await generateEmbeddings(texts);

    // Combine chunks with embeddings
    const chunksWithEmbeddings = allChunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index]
    }));

    // Group chunks by section and store each section
    const storedSections = [];
    const sectionMap = {};

    // Group chunks by section number
    chunksWithEmbeddings.forEach(chunk => {
      if (!sectionMap[chunk.sectionNumber]) {
        sectionMap[chunk.sectionNumber] = {
          sectionNumber: chunk.sectionNumber,
          sectionTitle: chunk.sectionTitle,
          sectionType: chunk.sectionType || null,
          chapterId: chunk.chapterId || chapterId,
          division: chunk.division || null,
          chunks: []
        };
      }
      sectionMap[chunk.sectionNumber].chunks.push(chunk);
    });

    console.log('[RAG] processPDFToSections - Section map:', Object.keys(sectionMap).map(key => ({
      sectionNumber: sectionMap[key].sectionNumber,
      sectionTitle: sectionMap[key].sectionTitle,
      sectionType: sectionMap[key].sectionType,
      division: sectionMap[key].division,
      chapterId: sectionMap[key].chapterId
    })));

    // Store each section with its chunks
    for (const sectionNumber in sectionMap) {
      const sectionData = sectionMap[sectionNumber];
      try {
        console.log('[RAG] processPDFToSections - Storing section:', {
          sectionNumber: sectionData.sectionNumber,
          sectionTitle: sectionData.sectionTitle,
          sectionType: sectionData.sectionType,
          bookType: bookType,
          chunkCount: sectionData.chunks.length
        });

        const storedSection = await storeSectionWithEmbeddings({
          chapterId: sectionData.chapterId,
          sectionNumber: sectionData.sectionNumber,
          sectionTitle: sectionData.sectionTitle,
          sectionType: sectionData.sectionType,
          division: sectionData.division,
          type: bookType || null,
          syllabusId,
          standardId,
          subjectId,
          chunks: sectionData.chunks,
          // College-specific metadata
          isCollegeEducation: isCollegeEducation,
          departmentId: departmentId || null,
          semesterId: semesterId || null,
          subject: subject || null,
          collegeChapterName: chapterName || null
        });
        storedSections.push(storedSection);
        console.log(`[RAG] Stored section ${sectionNumber}${sectionData.sectionType ? ` (${sectionData.sectionType})` : ''} with ${sectionData.chunks.length} chunks, bookType: ${bookType}, division: ${sectionData.division}`);
      } catch (sectionError) {
        console.warn(`[RAG] Warning: Could not store section ${sectionNumber}:`, sectionError.message);
      }
    }

    // Final verification
    const totalStoredChunks = storedSections.reduce((sum, s) => sum + (s.totalChunks || 0), 0);
    console.log(`[RAG] Successfully stored ${storedSections.length} sections with ${totalStoredChunks} total chunks`);
    console.log('[RAG] processPDFToSections - Final stored sections:', storedSections.map(s => ({
      sectionNumber: s.sectionNumber,
      sectionTitle: s.sectionTitle,
      type: s.type
    })));

    if (totalStoredChunks === 0) {
      console.error('[RAG] ERROR: No chunks were stored! Content may have been lost.');
    }

    return storedSections;
  } catch (error) {
    console.error('[RAG] Error processing PDF to sections:', error.message);
    throw error;
  }
}


/**
 * Process multiple PDFs
 * @param {Array<{buffer: Buffer, metadata: Object}>} pdfs - Array of PDFs with metadata
 * @returns {Promise<Object>} Results for each PDF
 */
async function processPDFsToSections(pdfs) {
  try {
    const results = {};

    for (const pdf of pdfs) {
      try {
        const chapterId = pdf.metadata?.chapterId;
        results[chapterId] = await processPDFToSections(pdf.buffer, pdf.metadata);
      } catch (error) {
        console.error('[RAG] Error processing PDF:', error.message);
        results[pdf.metadata?.chapterId] = { error: error.message };
      }
    }

    return results;
  } catch (error) {
    console.error('[RAG] Error processing multiple PDFs:', error.message);
    throw error;
  }
}

module.exports = {
  extractTextFromPDF,
  processPDFToSections,
  processPDFsToSections
};

