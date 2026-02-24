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
      syllabusId,
      standardId,
      subjectId,
      division,
      bookType,
      pageRanges,
      splitPattern = 'regex_based',
      sectionTitles,
      isTNStateBoard = false
    } = metadata;

    console.log('[RAG] processPDFToSections - START with metadata:', {
      chapterId,
      documentId,
      syllabusId,
      standardId,
      subjectId,
      division,
      bookType,
      splitPattern,
      isTNStateBoard
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
      const { splitByUnitsAndChapters } = require('./tnBoardSplitter');
      
      // First split by units, then by content types within each unit
      const units = splitByUnitsAndChapters(text);
      console.log(`[RAG] TN Board splitter returned ${units.length} units`);
      
      // Create chapters for each unit FIRST
      const hierarchyService = require('../file-hierarchy/service');
      const unitChapters = [];
      
      for (const unit of units) {
        try {
          // Create a chapter for this unit with unit name and number
          const unitChapterName = `Unit ${unit.unitNumber}`;
          const unitDocumentId = documentId || chapterId;
          const unitChapterData = await hierarchyService.createChapter(
            subjectId,
            unitChapterName,
            `${unitDocumentId}_unit_${unit.unitNumber}`,
            syllabusId,
            standardId,
            null
          );
          unitChapters.push({
            unitNumber: unit.unitNumber,
            chapterId: unitChapterData.chapterId,
            chapterName: unitChapterName
          });
          console.log(`[RAG] Created chapter for unit ${unit.unitNumber}: ${unitChapterData.chapterId} (${unitChapterName})`);
        } catch (e) {
          console.warn(`[RAG] Could not create chapter for unit ${unit.unitNumber}:`, e.message);
          // Fallback: use generated ID
          unitChapters.push({
            unitNumber: unit.unitNumber,
            chapterId: `${chapterId}_unit_${unit.unitNumber}`,
            chapterName: `Unit ${unit.unitNumber}`
          });
        }
      }
      
      // Process each unit as a separate chapter
      const storedSections = [];
      
      for (const unit of units) {
        // Find the chapter ID for this unit
        const unitChapter = unitChapters.find(uc => uc.unitNumber === unit.unitNumber);
        const unitChapterId = unitChapter?.chapterId || `${chapterId}_unit_${unit.unitNumber}`;
        
        console.log(`[RAG] Processing unit ${unit.unitNumber} with ${unit.sections.length} sections, chapterId: ${unitChapterId}`);
        
        // Convert unit sections to standard format
        const unitSections = unit.sections.map(s => ({
          sectionNumber: s.sectionNumber,
          sectionTitle: s.sectionTitle,
          sectionType: s.sectionType,
          content: s.content,
          unitNumber: s.unitNumber
        }));
        
        console.log('[RAG] Unit sections converted:', unitSections.map(s => ({
          sectionNumber: s.sectionNumber,
          sectionTitle: s.sectionTitle,
          sectionType: s.sectionType
        })));
        
        // Process sections to create chunks
        const { processSectionsToChunks } = require('./textSplitter');
        const allChunks = await processSectionsToChunks(unitSections);

        console.log(`[RAG] Created ${allChunks.length} chunks from unit ${unit.unitNumber} sections`);

        // Generate embeddings for all chunks
        const texts = allChunks.map(chunk => chunk.text);
        const embeddings = await generateEmbeddings(texts);

        // Combine chunks with embeddings
        const chunksWithEmbeddings = allChunks.map((chunk, index) => ({
          ...chunk,
          embedding: embeddings[index]
        }));

        // Group chunks by section and store each section
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

        console.log('[RAG] Section map for unit:', Object.keys(sectionMap).map(key => ({
          sectionNumber: sectionMap[key].sectionNumber,
          sectionTitle: sectionMap[key].sectionTitle,
          sectionType: sectionMap[key].sectionType
        })));

        // Store each section with its chunks in parallel (not sequential)
        const sectionStoragePromises = Object.entries(sectionMap).map(async ([sectionNumber, sectionData]) => {
          try {
            console.log('[RAG] Storing section:', {
              sectionNumber: sectionData.sectionNumber,
              sectionTitle: sectionData.sectionTitle,
              sectionType: sectionData.sectionType,
              unitNumber: unit.unitNumber,
              chapterId: unitChapterId,
              chunkCount: sectionData.chunks.length
            });

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
            
            console.log(`[RAG] Stored section ${sectionNumber} in unit ${unit.unitNumber} with ${sectionData.chunks.length} chunks`);
            return storedSection;
          } catch (sectionError) {
            console.warn(`[RAG] Warning: Could not store section ${sectionNumber}:`, sectionError.message);
            return null;
          }
        });

        // Wait for all sections to be stored in parallel
        const storedSectionsForUnit = await Promise.all(sectionStoragePromises);
        storedSections.push(...storedSectionsForUnit.filter(s => s !== null));
      }

      // Final verification
      const totalStoredChunks = storedSections.reduce((sum, s) => sum + (s.totalChunks || 0), 0);
      console.log(`[RAG] Successfully stored ${storedSections.length} sections with ${totalStoredChunks} total chunks`);
      console.log('[RAG] processPDFToSections - Final stored sections:', storedSections.map(s => ({
        sectionNumber: s.sectionNumber,
        sectionTitle: s.sectionTitle,
        sectionType: s.sectionType
      })));

      if (totalStoredChunks === 0) {
        console.error('[RAG] ERROR: No chunks were stored! Content may have been lost.');
      }

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
      sectionTitle: s.sectionTitle,
      sectionType: s.sectionType
    })));

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

