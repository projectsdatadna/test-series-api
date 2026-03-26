/**
 * TN State Board Book Splitter
 * Two-level hierarchy: Units (Chapters) → Sections
 *
 * Handles multiple book formats with fallback strategies:
 * - Strategy 1: "Unit" keyword with number (Term I format)
 * - Strategy 2: Number repeated before "Prose" (Term II/III format)
 * - Strategy 3: Section numbers (e.g., "Section 1", "Section 2")
 * - Strategy 4: Page-based splitting as last resort
 *
 * Flow:
 * 1. Try each unit detection strategy until one succeeds
 * 2. For each Unit, create a Chapter in DB
 * 3. Try each section detection strategy until one succeeds
 * 4. Store each Section in DB linked to its Unit's Chapter
 */

/**
 * Strategy 1: Find units using "Unit" keyword
 */
function findUnitsWithKeyword(lines) {
  const unitMatches = [];

  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i].trim();

    if (line.match(/^Unit$/i)) {
      let unitNumber = null;
      let unitTitle = 'Unit';
      let titleLineIndex = -1;

      const prevLine = lines[i - 1].trim();
      const prevMatch = prevLine.match(/^(\d+)$/);

      if (prevMatch) {
        unitNumber = parseInt(prevMatch[1]);
        if (i >= 2) titleLineIndex = i - 2;
      } else {
        const nextLine = lines[i + 1].trim();
        const nextMatch = nextLine.match(/^(\d+)$/);
        if (nextMatch) {
          unitNumber = parseInt(nextMatch[1]);
          titleLineIndex = i - 1;
        }
      }

      if (unitNumber !== null && unitNumber >= 1 && unitNumber <= 10) {
        unitTitle = `Unit ${unitNumber}`;
        if (titleLineIndex >= 0) {
          const titleLine = lines[titleLineIndex].trim();
          if (titleLine && !titleLine.match(/^\d+$/) && titleLine.length > 0 && titleLine.length < 100) {
            unitTitle = titleLine;
          }
        }

        console.log(`[RAG] Strategy 1 - Found Unit ${unitNumber} at line ${i}, title: "${unitTitle}"`);
        unitMatches.push({ unitNumber, unitTitle, lineIndex: i });
      }
    }
  }

  return unitMatches;
}

/**
 * Strategy 2: Find units by number repetition before "Prose", "Play", or "Chapter"
 * Also handles direct "Chapter" pattern: number → "Chapter" → title
 */
function findUnitsByNumberRepetition(lines) {
  const unitMatches = [];

  for (let i = 0; i < lines.length - 50; i++) {
    const line = lines[i].trim();
    const numberMatch = line.match(/^(\d+)$/);

    if (numberMatch) {
      const unitNumber = parseInt(numberMatch[1]);
      if (unitNumber < 1 || unitNumber > 15) continue;

      // PATTERN 1: Check for direct "Chapter" pattern (Mathematics books)
      // Format: number → "Chapter" → title
      // This is the most reliable pattern for Maths books, so check it first
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine.match(/^Chapter$/i)) {
          // Get title from line after "Chapter"
          let unitTitle = `Unit ${unitNumber}`;
          if (i + 2 < lines.length) {
            const titleLine = lines[i + 2].trim();
            if (titleLine &&
                !titleLine.match(/^\d+$/) &&
                !titleLine.match(/^www\./i) &&
                !titleLine.match(/\.indd/i) &&
                titleLine.length > 3 &&
                titleLine.length < 100) {
              unitTitle = titleLine;
            }
          }

          console.log(`[RAG] Strategy 2 (Direct Chapter) - Found Unit ${unitNumber} at line ${i + 1}, title: "${unitTitle}"`);
          unitMatches.push({ unitNumber, unitTitle, lineIndex: i + 1 });
          continue; // Skip to next iteration, don't check pattern 2
        }
      }

      // PATTERN 2: Look ahead for same number, then "Prose", "Play" within next 20 lines
      // Skip "Chapter" here since we already handled it in Pattern 1
      for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
        const checkLine = lines[j].trim();

        if (checkLine === line) {
          // Look for "Prose" or "Play" marker within next 20 lines (NOT "Chapter")
          let markerLineIndex = -1;
          let markerType = null;
          for (let k = j + 1; k < Math.min(j + 20, lines.length); k++) {
            const marker = lines[k].trim();
            if (marker.match(/^(Prose|Play)$/i)) {
              markerLineIndex = k;
              markerType = marker;
              break;
            }
          }

          if (markerLineIndex >= 0) {
            // Find title between i and j
            let unitTitle = `Unit ${unitNumber}`;

            for (let k = i + 1; k < j; k++) {
              const titleLine = lines[k].trim();
              if (titleLine &&
                  !titleLine.match(/^\d+$/) &&
                  !titleLine.match(/^www\./i) &&
                  !titleLine.match(/\.indd/i) &&
                  !titleLine.match(/^(Both|Catch|Oops|Let|The teacher|MIRRORING|Work in|Now,|Where|Would|How|Why|Yes,|See how|Madhi!)/i) &&
                  !titleLine.match(/[.!?]$/) &&
                  !titleLine.match(/^(Let's|I |You |We |They |He |She |It |This |That )/i) &&
                  !titleLine.match(/^\d+\./) &&
                  !titleLine.match(/excited|enjoy|watching/i) &&
                  titleLine.length > 3 &&
                  titleLine.length < 80) {
                unitTitle = titleLine;
                break;
              }
            }

            console.log(`[RAG] Strategy 2 (Number Repetition) - Found Unit ${unitNumber} at line ${markerLineIndex}, title: "${unitTitle}", marker: "${markerType}"`);
            unitMatches.push({ unitNumber, unitTitle, lineIndex: markerLineIndex - 1 });
            break;
          }
        }
      }
    }
  }

  return unitMatches;
}

/**
 * Strategy 3: Find units by section numbers (e.g., "Section 1", "Section I")
 */
function findUnitsBySectionNumbers(lines) {
  const unitMatches = [];
  let currentUnit = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match "Section 1", "Section I", "Section One", etc.
    const sectionMatch = line.match(/^Section\s+(1|I|One)$/i);

    if (sectionMatch) {
      currentUnit++;

      // Find title in nearby lines
      let unitTitle = `Unit ${currentUnit}`;
      for (let j = Math.max(0, i - 10); j < Math.min(i + 10, lines.length); j++) {
        const titleLine = lines[j].trim();
        if (titleLine &&
            !titleLine.match(/^Section/i) &&
            !titleLine.match(/^\d+$/) &&
            !titleLine.match(/^www\./i) &&
            titleLine.length > 5 &&
            titleLine.length < 80) {
          unitTitle = titleLine;
          break;
        }
      }

      console.log(`[RAG] Strategy 3 - Found Unit ${currentUnit} at line ${i}, title: "${unitTitle}"`);
      unitMatches.push({ unitNumber: currentUnit, unitTitle, lineIndex: i });
    }
  }

  return unitMatches;
}

/**
 * Split TN State Board book by units using multiple strategies
 */
function splitByUnits(text) {
  console.log('[RAG] tnBoardSplitter - splitByUnits START');

  const lines = text.split('\n');
  const units = [];
  let unitMatches = [];

  // Try Strategy 1: "Unit" keyword
  console.log('[RAG] Trying Strategy 1: Unit keyword detection');
  unitMatches = findUnitsWithKeyword(lines);

  if (unitMatches.length === 0) {
    // Try Strategy 2: Number repetition before "Prose"
    console.log('[RAG] Strategy 1 failed, trying Strategy 2: Number repetition');
    unitMatches = findUnitsByNumberRepetition(lines);
  }

  if (unitMatches.length === 0) {
    // Try Strategy 3: Section numbers
    console.log('[RAG] Strategy 2 failed, trying Strategy 3: Section numbers');
    unitMatches = findUnitsBySectionNumbers(lines);
  }

  if (unitMatches.length === 0) {
    // Last resort: Split by page count (assume 30-50 pages per unit)
    console.log('[RAG] All strategies failed, using fallback: page-based splitting');
    const estimatedUnits = Math.max(1, Math.floor(lines.length / 800)); // ~800 lines per unit
    for (let i = 1; i <= Math.min(estimatedUnits, 5); i++) {
      unitMatches.push({
        unitNumber: i,
        unitTitle: `Unit ${i}`,
        lineIndex: Math.floor((i - 1) * lines.length / estimatedUnits)
      });
    }
  }

  console.log(`[RAG] tnBoardSplitter - Total unit markers found: ${unitMatches.length}`);

  // Remove duplicates - keep last occurrence
  const uniqueUnits = new Map();
  unitMatches.forEach(unit => uniqueUnits.set(unit.unitNumber, unit));
  const filteredMatches = Array.from(uniqueUnits.values()).sort((a, b) => a.lineIndex - b.lineIndex);

  console.log(`[RAG] tnBoardSplitter - After removing duplicates: ${filteredMatches.length} unique units`);

  if (filteredMatches.length === 0) {
    console.log('[RAG] tnBoardSplitter - No units found in text');
    console.log('[RAG] tnBoardSplitter - Total lines in text:', lines.length);
    return [];
  }

  // Extract content for each unit
  for (let i = 0; i < filteredMatches.length; i++) {
    const currentUnit = filteredMatches[i];
    const nextUnitLineIndex = i < filteredMatches.length - 1 ? filteredMatches[i + 1].lineIndex : lines.length;

    let contentStartLine = currentUnit.lineIndex + 1;

    // Skip the title line if it's just a number
    if (contentStartLine < lines.length && lines[contentStartLine].trim().match(/^\d+$/)) {
      contentStartLine++;
    }

    // For Mathematics books: Check if there's a X.1 Introduction section BEFORE the Chapter marker
    // This happens when Introduction appears before the Chapter title in the PDF
    const prevUnitLineIndex = i > 0 ? filteredMatches[i - 1].lineIndex : 0;
    const introPattern = new RegExp(`^${currentUnit.unitNumber}\\.1\\s+Introduction`, 'i');

    // Look backwards from Chapter marker to find Introduction section
    for (let j = currentUnit.lineIndex - 1; j >= prevUnitLineIndex; j--) {
      const line = lines[j].trim();
      if (line.match(introPattern)) {
        console.log(`[RAG] Found Introduction section for Unit ${currentUnit.unitNumber} at line ${j} (before Chapter marker)`);
        contentStartLine = j; // Start from Introduction section
        break;
      }
      // Stop searching if we hit another chapter or go back too far (more than 100 lines)
      if (line.match(/^Chapter$/i) || (currentUnit.lineIndex - j) > 100) {
        break;
      }
    }

    const unitContent = lines.slice(contentStartLine, nextUnitLineIndex).join('\n').trim();
    console.log(`[RAG] tnBoardSplitter - Unit ${currentUnit.unitNumber} ("${currentUnit.unitTitle}"): ${unitContent.length} characters`);

    units.push({
      unitNumber: currentUnit.unitNumber,
      unitTitle: currentUnit.unitTitle,
      content: unitContent,
      contentLength: unitContent.length
    });
  }

  console.log(`[RAG] tnBoardSplitter - splitByUnits COMPLETE: ${units.length} units extracted`);
  return units;
}

/**
 * Strategy 1: Split by Prose/Poem/Supplementary/Chapter markers
 * @param {Array<string>} lines - Content lines
 * @param {number} unitNumber - Unit number
 * @param {string} unitTitle - Unit title (optional)
 * @param {string} subjectId - Subject ID (optional, for subject-specific logic)
 */
function splitByStandardMarkers(lines, unitNumber, unitTitle, subjectId = null) {
  const sectionMatches = [];

  // Check if this is a Mathematics book
  const isMathsBook = subjectId && (subjectId.includes('MAT') || subjectId.includes('MATH'));

  // For Maths books, don't use "Chapter" as a section marker (it's a unit marker)
  // For other books, include "Chapter" as a section marker
  const markerPattern = isMathsBook
    ? /^(Prose|Poem|Supplementary|Play)$/i
    : /^(Prose|Poem|Supplementary|Play|Chapter)$/i;

  // Find the FIRST actual Prose section (skip content table)
  // Content table is typically in first 300-400 lines, actual content starts after
  let proseLineIndex = -1;
  for (let i = 300; i < lines.length; i++) {
    if (lines[i].trim().match(/^Prose$/i)) {
      proseLineIndex = i;
      break;
    }
  }

  // If no Prose found after line 300, search from beginning
  if (proseLineIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().match(/^Prose$/i)) {
        proseLineIndex = i;
        break;
      }
    }
  }

  const startLine = proseLineIndex >= 0 ? proseLineIndex : 0;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    const sectionMatch = line.match(markerPattern);

    if (sectionMatch) {
      const sectionType = sectionMatch[1].toLowerCase();
      let sectionTitle = sectionType.charAt(0).toUpperCase() + sectionType.slice(1);

      // PRIORITY 1: Check the line IMMEDIATELY before the marker (most common pattern)
      if (i > 0) {
        const prevLine = lines[i - 1].trim();

        // Check if it's a valid title (not a number, not empty, reasonable length)
        if (prevLine &&
            !prevLine.match(/^\d+$/) &&                                    // Not just a number
            !prevLine.match(/^www\./i) &&                                  // Not a URL
            !prevLine.match(/\.indd/i) &&                                  // Not a filename
            !prevLine.match(/^\d{1,2}-\d{1,2}-\d{4}/i) &&                 // Not a date
            !prevLine.match(/^(Unit|Prose|Poem|Supplementary|Reader|\*Poem|UNITTOPICPAGE)$/i) && // Not a marker
            !prevLine.match(/^(WARM UP|GLOSSARY|ICT Corner|VOCABULARY)$/i) && // Not activity headers
            prevLine.length >= 5 &&                                        // Not too short
            prevLine.length <= 100) {                                      // Not too long

          // Clean the title
          const cleanTitle = prevLine.replace(/^\*+/, '').trim();

          // Additional validation: should look like a title
          const hasProperCapitalization = cleanTitle[0] === cleanTitle[0].toUpperCase();
          const notASentence = !cleanTitle.match(/^(Let's|I |You |We |They |He |She |It |This |That |The |A |An |How |What |Why |When |Where |Who )/i);
          const notAnAuthor = !cleanTitle.match(/^(Raj Arumugam|Lewis Carroll|Sara Coleridge|Ruskin Bond|Roald Dahl|R\.K\. Narayan|William Makepeace Thackeray|Nisha Dyrene|Savita Singh)$/i);
          const notADescription = !cleanTitle.match(/(appears in it|based on|written by|adapted|translated|retold)/i);
          const notAQuestion = !cleanTitle.match(/\?$/);

          if (hasProperCapitalization && notASentence && notAnAuthor && notADescription && notAQuestion) {
            sectionTitle = cleanTitle;
            console.log(`[RAG] Found title for ${sectionType} at line ${i} (line before marker): "${sectionTitle}"`);
            sectionMatches.push({ type: sectionType, title: sectionTitle, lineIndex: i });
            continue;
          }
        }
      }

      // PRIORITY 2: Look for title in lines 2-15 before the marker
      const potentialTitles = [];
      for (let j = i - 2; j >= Math.max(0, i - 15); j--) {
        const titleLine = lines[j].trim();

        // Skip invalid lines
        if (!titleLine ||
            titleLine.match(/^\d+$/) ||                                    // Just numbers
            titleLine.match(/^www\./i) ||                                  // URLs
            titleLine.match(/\.indd/i) ||                                  // File names
            titleLine.match(/^\d{1,2}-\d{1,2}-\d{4}/i) ||                 // Dates
            titleLine.match(/^(Unit|Prose|Poem|Supplementary|Reader|\*Poem)$/i) || // Section markers
            titleLine.match(/^(WARM UP|GLOSSARY|Talk about|Do you know|ICT Corner|VOCABULARY|Look at)/i) || // Activity headers
            titleLine.match(/^(How|What|Why|When|Where|Who|Which|Can|Do|Does|Is|Are|Will|Would|Should)/i) || // Questions
            titleLine.match(/^\w+\s+-\s+\w+/i) ||                         // Author format "Name - Name"
            titleLine.match(/(appears in it|based on|written by|adapted|translated|retold)/i) || // Descriptions
            titleLine.match(/^(Raj Arumugam|Lewis Carroll|Sara Coleridge|Ruskin Bond|Roald Dahl|R\.K\. Narayan|William Makepeace Thackeray|Nisha Dyrene|Savita Singh)$/i) || // Author names
            titleLine.match(/^(Let's|I |You |We |They |He |She |It |This |That |The |A |An )/i) || // Sentence starts
            titleLine.match(/[.!?]$/) ||                                  // Ends with punctuation (likely sentence)
            titleLine.match(/^\d+\./) ||                                  // Numbered list
            titleLine.match(/^(excited|enjoy|watching|reading|listening)/i) || // Activity words
            titleLine.length < 5 ||                                       // Too short
            titleLine.length > 100) {                                     // Too long
          continue;
        }

        // Clean the title
        const cleanTitle = titleLine.replace(/^\*+/, '').trim();

        // Check if it looks like a proper title (mostly title case or all caps)
        const wordCount = cleanTitle.split(/\s+/).length;
        const capitalizedWords = cleanTitle.split(/\s+/).filter(word =>
          word.length > 0 && (word[0] === word[0].toUpperCase() || word === word.toUpperCase())
        ).length;

        // If most words are capitalized, it's likely a title
        if (capitalizedWords >= Math.max(1, wordCount * 0.5)) {
          potentialTitles.push({
            title: cleanTitle,
            distance: i - j,
            capitalRatio: capitalizedWords / wordCount
          });
        }
      }

      // Choose the best title: prefer closer titles with high capital ratio
      if (potentialTitles.length > 0) {
        // Sort by distance (closer is better) and capital ratio (higher is better)
        potentialTitles.sort((a, b) => {
          if (a.distance <= 5 && b.distance <= 5) {
            return b.capitalRatio - a.capitalRatio; // Prefer higher capital ratio if both are close
          }
          return a.distance - b.distance; // Otherwise prefer closer
        });

        sectionTitle = potentialTitles[0].title;
        console.log(`[RAG] Found title for ${sectionType} at line ${i} (fallback search): "${sectionTitle}" at distance ${potentialTitles[0].distance}`);
      } else {
        console.log(`[RAG] No title found for ${sectionType} at line ${i}, using default: "${sectionTitle}"`);
      }

      sectionMatches.push({ type: sectionType, title: sectionTitle, lineIndex: i });
    }
  }

  return sectionMatches;
}

/**
 * Strategy 2: Split by section numbers (e.g., "1.1 Title", "1.2 Title" for Maths books)
 * @param {Array<string>} lines - Content lines
 * @param {number} unitNumber - Unit number
 * @param {string} subjectId - Subject ID (optional, for subject-specific logic)
 */
function splitBySectionNumbers(lines, unitNumber, subjectId = null) {
  const sectionMatches = [];

  // Check if this is a Mathematics book - only then use decimal section numbers
  const isMathsBook = subjectId && (subjectId.includes('MAT') || subjectId.includes('MATH'));

  // Pattern 1: Decimal section numbers (e.g., "1.1 Introduction", "1.2 Formation")
  // This is ONLY for Mathematics books
  if (isMathsBook) {
    console.log(`[RAG] Mathematics book detected (${subjectId}), using decimal section number detection`);
    const decimalPattern = new RegExp(`^${unitNumber}\\.(\\d+)\\s+(.+)$`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for decimal section numbers (X.Y Title)
      const decimalMatch = line.match(decimalPattern);
      if (decimalMatch) {
        const sectionNum = parseInt(decimalMatch[1]);
        const title = decimalMatch[2].trim();

        // Validate title (not too short, not too long, not just numbers)
        if (title.length > 3 && title.length < 100 && !title.match(/^\d+$/)) {
          console.log(`[RAG] Found section ${unitNumber}.${sectionNum}: "${title}" at line ${i}`);
          sectionMatches.push({
            type: 'section',
            title: title,
            lineIndex: i,
            sectionNum: sectionNum
          });
        }
      }
    }

    // If we found decimal sections, return them
    if (sectionMatches.length > 0) {
      console.log(`[RAG] Found ${sectionMatches.length} decimal section numbers for Maths book`);
      return sectionMatches;
    }
  }

  // Pattern 2: "Section 1", "Section 2" format (for all books)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const sectionMatch = line.match(/^Section\s+(\d+|I{1,3}|One|Two|Three)$/i);

    if (sectionMatch) {
      let sectionNum = 1;
      const numStr = sectionMatch[1];
      if (numStr.match(/^\d+$/)) {
        sectionNum = parseInt(numStr);
      } else if (numStr.match(/^I{1,3}$/i)) {
        sectionNum = numStr.length;
      } else {
        const wordMap = { 'one': 1, 'two': 2, 'three': 3 };
        sectionNum = wordMap[numStr.toLowerCase()] || 1;
      }

      // Find title
      let sectionTitle = `Section ${sectionNum}`;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const titleLine = lines[j].trim();
        if (titleLine && titleLine.length > 3 && titleLine.length < 80 &&
            !titleLine.match(/^\d+$/) && !titleLine.match(/^www\./i)) {
          sectionTitle = titleLine;
          break;
        }
      }

      console.log(`[RAG] Found section ${sectionNum}: "${sectionTitle}" at line ${i}`);
      sectionMatches.push({
        type: 'section',
        title: sectionTitle,
        lineIndex: i,
        sectionNum: sectionNum
      });
    }
  }

  return sectionMatches;
}

/**
 * Strategy 3: Split by content length (equal chunks)
 */
function splitByContentLength(content, unitNumber, chunkCount = 3) {
  const lines = content.split('\n');
  const chunkSize = Math.floor(lines.length / chunkCount);
  const sections = [];

  for (let i = 0; i < chunkCount; i++) {
    const startLine = i * chunkSize;
    const endLine = i === chunkCount - 1 ? lines.length : (i + 1) * chunkSize;
    const sectionContent = lines.slice(startLine, endLine).join('\n').trim();

    sections.push({
      type: 'content',
      title: `Part ${i + 1}`,
      lineIndex: startLine,
      content: sectionContent
    });
  }

  return sections;
}

/**
 * Split unit content by sections using multiple strategies
 * @param {string} content - Unit content text
 * @param {number} unitNumber - Unit number
 * @param {string} unitTitle - Unit title (optional)
 * @param {Array<string>} customTitles - Custom section titles (optional)
 * @param {string} subjectId - Subject ID for subject-specific logic (optional)
 */
function splitBySections(content, unitNumber, unitTitle = null, customTitles = null, subjectId = null) {
  console.log(`[RAG] tnBoardSplitter - splitBySections START for Unit ${unitNumber}, subjectId: ${subjectId}`);

  const lines = content.split('\n');
  let sectionMatches = [];

  // If custom titles are provided, use them directly
  if (customTitles && Array.isArray(customTitles) && customTitles.length > 0) {
    console.log(`[RAG] Using custom section titles for Unit ${unitNumber}:`, customTitles);

    // Find section markers and assign custom titles
    const markers = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^(Prose|Poem|Supplementary|Play|Chapter)$/i)) {
        markers.push({ lineIndex: i, type: line.toLowerCase() });
      }
    }

    console.log(`[RAG] Found ${markers.length} section markers for Unit ${unitNumber}`);

    // If no markers found but custom titles provided, split content equally
    if (markers.length === 0) {
      console.log(`[RAG] No section markers found, splitting content equally for ${customTitles.length} sections`);

      const chunkSize = Math.floor(lines.length / customTitles.length);
      const sections = [];

      for (let i = 0; i < customTitles.length; i++) {
        const startLine = i * chunkSize;
        const endLine = i === customTitles.length - 1 ? lines.length : (i + 1) * chunkSize;
        const sectionContent = lines.slice(startLine, endLine).join('\n').trim();

        sections.push({
          sectionNumber: `${unitNumber}.${i + 1}`,
          sectionTitle: customTitles[i],
          sectionType: 'content',
          content: sectionContent,
          contentLength: sectionContent.length,
          unitNumber: unitNumber
        });

        console.log(`[RAG] Section ${unitNumber}.${i + 1}: "${customTitles[i]}" (content), ${sectionContent.length} chars`);
      }

      console.log(`[RAG] tnBoardSplitter - splitBySections COMPLETE: ${sections.length} sections with custom titles (no markers)`);
      return sections;
    }

    // Assign custom titles to markers
    const sections = [];
    for (let i = 0; i < Math.min(markers.length, customTitles.length); i++) {
      const marker = markers[i];
      const nextMarkerLineIndex = i < markers.length - 1 ? markers[i + 1].lineIndex : lines.length;

      const contentStartLine = marker.lineIndex + 1;
      const sectionContent = lines.slice(contentStartLine, nextMarkerLineIndex).join('\n').trim();

      sections.push({
        sectionNumber: `${unitNumber}.${i + 1}`,
        sectionTitle: customTitles[i],
        sectionType: marker.type,
        content: sectionContent,
        contentLength: sectionContent.length,
        unitNumber: unitNumber
      });

      console.log(`[RAG] Section ${unitNumber}.${i + 1}: "${customTitles[i]}" (${marker.type}), ${sectionContent.length} chars`);
    }

    console.log(`[RAG] tnBoardSplitter - splitBySections COMPLETE: ${sections.length} sections with custom titles`);
    return sections;
  }

  // Try Strategy 1: Standard markers (Prose/Poem/Supplementary)
  console.log('[RAG] Trying section Strategy 1: Standard markers');
  sectionMatches = splitByStandardMarkers(lines, unitNumber, unitTitle, subjectId);

  if (sectionMatches.length === 0) {
    // Try Strategy 2: Section numbers (prioritize for Maths books)
    console.log('[RAG] Section Strategy 1 failed, trying Strategy 2: Section numbers');
    sectionMatches = splitBySectionNumbers(lines, unitNumber, subjectId);
  }

  if (sectionMatches.length === 0) {
    // Try Strategy 3: Content-based splitting
    console.log('[RAG] Section Strategy 2 failed, using Strategy 3: Content-based splitting');
    const contentSections = splitByContentLength(content, unitNumber, 3);

    return contentSections.map((section, index) => ({
      sectionNumber: `${unitNumber}.${index + 1}`,
      sectionTitle: section.title,
      sectionType: section.type,
      content: section.content,
      contentLength: section.content.length,
      unitNumber: unitNumber
    }));
  }

  console.log(`[RAG] tnBoardSplitter - Total section markers found: ${sectionMatches.length}`);

  // Filter duplicates - for section numbers, keep unique section numbers
  const seenSections = new Set();
  const filteredMatches = sectionMatches.filter(section => {
    // For decimal section numbers (1.1, 1.2), use sectionNum as key
    const key = section.sectionNum !== undefined ? section.sectionNum : section.type;

    if (seenSections.has(key)) {
      console.log(`[RAG] tnBoardSplitter - Skipping duplicate section ${key}`);
      return false;
    }
    seenSections.add(key);
    return true;
  });

  console.log(`[RAG] tnBoardSplitter - After filtering: ${filteredMatches.length} unique sections`);

  // Extract content for each section
  const sections = [];
  for (let i = 0; i < filteredMatches.length; i++) {
    const currentSection = filteredMatches[i];
    const nextSectionLineIndex = i < filteredMatches.length - 1
      ? filteredMatches[i + 1].lineIndex
      : lines.length;

    const contentStartLine = currentSection.lineIndex + 1;
    const sectionContent = lines.slice(contentStartLine, nextSectionLineIndex).join('\n').trim();

    sections.push({
      sectionNumber: `${unitNumber}.${i + 1}`,
      sectionTitle: currentSection.title,
      sectionType: currentSection.type,
      content: sectionContent,
      contentLength: sectionContent.length,
      unitNumber: unitNumber
    });
  }

  console.log(`[RAG] tnBoardSplitter - splitBySections COMPLETE: ${sections.length} sections extracted`);
  return sections;
}

/**
 * Validate if text appears to be a TN State Board book
 */
function isTNBoardFormat(text) {
  const lines = text.split('\n');

  // Check for "Unit" keyword
  for (let i = 1; i < Math.min(lines.length, 500); i++) {
    const line = lines[i].trim();
    const prevLine = lines[i - 1].trim();
    const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : '';

    if (line.match(/^Unit$/i) && (prevLine.match(/^\d+$/) || nextLine.match(/^\d+$/))) {
      console.log('[RAG] tnBoardSplitter - isTNBoardFormat: true (Unit keyword found)');
      return true;
    }
  }

  // Check for Prose/Poem/Supplementary pattern
  let proseCount = 0;
  for (let i = 0; i < Math.min(lines.length, 1000); i++) {
    if (lines[i].trim().match(/^(Prose|Poem|Supplementary)$/i)) {
      proseCount++;
      if (proseCount >= 2) {
        console.log('[RAG] tnBoardSplitter - isTNBoardFormat: true (Section markers found)');
        return true;
      }
    }
  }

  console.log('[RAG] tnBoardSplitter - isTNBoardFormat: false');
  return false;
}

/**
 * Get statistics about units and sections
 */
function getStatistics(units) {
  const stats = {
    totalUnits: units.length,
    totalContent: 0,
    unitDetails: []
  };

  units.forEach(unit => {
    stats.totalContent += unit.contentLength || 0;
    stats.unitDetails.push({
      unitNumber: unit.unitNumber,
      unitTitle: unit.unitTitle,
      contentLength: unit.contentLength
    });
  });

  console.log('[RAG] tnBoardSplitter - Statistics:', stats);
  return stats;
}

module.exports = {
  splitByUnits,
  splitBySections,
  isTNBoardFormat,
  getStatistics
};
