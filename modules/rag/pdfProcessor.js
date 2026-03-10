/**
 * PDF Processor Service
 * Extracts text from PDF, splits into sections, generates embeddings, and stores in sections table
 */

const pdfParse = require('pdf-parse');
const { generateEmbeddings } = require('./embeddings');
const { processSectionsToChunks } = require('./textSplitter');
const { storeSectionWithEmbeddings } = require('./sectionStore');

/**
 * Extract text from PDF buffer
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPDF(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    const text = data.text;
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
      unitSectionTitles
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
      term
    });

    if (!chapterId) {
      throw new Error('chapterId is required in metadata');
    }

    // Extract text from PDF
    const text = await extractTextFromPDF(pdfBuffer);
    const originalTextLength = text.length;

    // Split into sections based on the specified pattern
    let sections;
    
    // Check if this is TN State Board book - use specialized splitting
    if (isTNStateBoard) {
      console.log('[RAG] processPDFToSections - Detected TN State Board book');
      if (term) {
        console.log(`[RAG] processPDFToSections - Processing ${term}`);
      }
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
          const contentFromLastUnit = lines.slice(lastUnitStartLine).join('\n');
          
          // Re-split this content to include the missing units
          const totalUnitsInThisSection = (maxProvidedUnit - maxDetectedUnit) + 1; // +1 for the last detected unit
          const linesInThisSection = lines.slice(lastUnitStartLine);
          
          // Remove the last detected unit from our units array (we'll re-add it with correct boundaries)
          if (units.length > 0) {
            units.pop();
          }
          
          // Split the content equally among all units in this section
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
            null,
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
      return storedSections;
    } else {
      // Check if this is 9th or 10th English - use specialized splitting
      const isEnglish9or10 = (standardId === 'STD_9' || standardId === 'STD_10' || standardId === '9' || standardId === '10') && 
                             (subjectId === 'SUB_ENG' || subjectId === 'English');
      
      console.log('[RAG] processPDFToSections - isEnglish9or10:', isEnglish9or10, 'division:', division, 'bookType:', bookType);

      // For 9th/10th English with heading_based pattern and sectionTitles, use heading-based splitting
      if (isEnglish9or10 && splitPattern === 'heading_based' && sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0) {
        console.log(`[RAG] Using heading_based splitting for ${standardId} ${subjectId} with provided section titles`);
        const { splitByHeadings } = require('./textSplitter');
        const headingSections = splitByHeadings(text, sectionTitles);
        // Convert heading sections to standard format with sectionType
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
        const { splitEnglishBook } = require('./englishSplitter');
        console.log(`[RAG] Using English-specific splitting for ${standardId} ${subjectId} - ${division}`);
        sections = splitEnglishBook(text, division);
        console.log('[RAG] English splitter returned sections:', sections.map(s => ({
          sectionNumber: s.sectionNumber,
          sectionTitle: s.sectionTitle,
          sectionType: s.sectionType
        })));
      } else if (subjectId === 'SUB_HIN' || subjectId === 'Hindi' || subjectId === 'हिंदी') {
        // Use Hindi-specific splitting for NCERT Hindi books
        const { splitHindiBook, splitHindiBookByHeadings, splitHindiBookWithTitles } = require('./hindiSplitter');
        console.log(`[RAG] Using Hindi-specific splitting for ${standardId} ${subjectId}`);
        
        // Use heading-based splitting (stops after पाठ से) for NCERT Hindi books
        if (syllabusId && syllabusId.toUpperCase().includes('NCERT')) {
          console.log(`[RAG] Detected NCERT Hindi book, using heading-based splitting`);
          sections = splitHindiBookByHeadings(text);
        } else if (sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0) {
          console.log(`[RAG] Using custom section titles for Hindi book: ${sectionTitles.length} sections`);
          sections = splitHindiBookWithTitles(text, sectionTitles);
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
        // Use page-based splitting if pageRanges provided (takes precedence)
        if (splitPattern && splitPattern !== 'regex_based') {
          console.warn(`[RAG] splitPattern '${splitPattern}' is ignored because pageRanges is provided`);
        }
        const { splitByPageRanges } = require('./textSplitter');
        sections = splitByPageRanges(text, pageRanges);
        console.log(`[RAG] Using page_ranges splitting strategy`);
      } else {
        // Use the specified split pattern
        const { splitBySections, splitByChaptersAndSections, splitByManualAnchors, splitByHeadings } = require('./textSplitter');
        
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
            // Default manual anchors for common book structures
            const defaultAnchors = [
              { title: 'The Day the River Spoke', start: 'The Day the River Spoke' },
              { title: 'Try Again', start: 'Try Again' },
              { title: 'Three Days to See', start: 'Three Days to See' }
            ];
            sections = splitByManualAnchors(text, defaultAnchors);
            break;
          
          default:
            console.log(`[RAG] Unknown split pattern '${splitPattern}', defaulting to regex_based`);
            sections = splitBySections(text);
        }
      }
    }

    console.log('[RAG] processPDFToSections - Sections after splitting:', sections.map(s => ({
      sectionNumber: s.sectionNumber,
      sectionTitle: s.title || s.sectionTitle,
      sectionType: s.sectionType
    })));

    // SPECIAL CASE: If only one section found, use chapter name as section title
    if (sections.length === 1 && chapterName) {
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
      console.log(`[RAG] Only one section found but chapterName not available. Current title: "${sections[0].title || sections[0].sectionTitle}"`);
    }

    // Verify section content
    const totalSectionLength = sections.reduce((sum, s) => sum + s.content.length, 0);

    // Process sections to create chunks
    const { processSectionsToChunks } = require('./textSplitter');
    const allChunks = await processSectionsToChunks(sections);

    console.log('[RAG] processPDFToSections - Chunks after processing:', allChunks.slice(0, 3).map(c => ({
      sectionNumber: c.sectionNumber,
      sectionTitle: c.sectionTitle,
      sectionType: c.sectionType
    })));

    // Verify chunk content
    const totalChunkLength = allChunks.reduce((sum, c) => sum + c.text.length, 0);

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
          chunks: []
        };
      }
      sectionMap[chunk.sectionNumber].chunks.push(chunk);
    });

    console.log('[RAG] processPDFToSections - Section map:', Object.keys(sectionMap).map(key => ({
      sectionNumber: sectionMap[key].sectionNumber,
      sectionTitle: sectionMap[key].sectionTitle,
      sectionType: sectionMap[key].sectionType
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
          chapterId,
          sectionNumber: sectionData.sectionNumber,
          sectionTitle: sectionData.sectionTitle,
          sectionType: sectionData.sectionType,
          type: bookType || null,
          syllabusId,
          standardId,
          subjectId,
          chunks: sectionData.chunks
        });
        storedSections.push(storedSection);
        console.log(`[RAG] Stored section ${sectionNumber}${sectionData.sectionType ? ` (${sectionData.sectionType})` : ''} with ${sectionData.chunks.length} chunks, bookType: ${bookType}`);
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

