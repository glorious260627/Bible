import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceDir = process.argv[2];
const outputFile = process.argv[3];
const bcvEsmDir = process.argv[4];
const limitsOutputFile = process.argv[5] || join(dirname(outputFile || ''), '..', 'scripts', 'bible-limits.json');

if (!sourceDir || !outputFile || !bcvEsmDir) {
  throw new Error('Usage: node scripts/generate-bible-structure.mjs USFM_DIR OUTPUT_FILE BCV_ESM_DIR');
}

const BOOKS = [
  ['GEN', '창세기', 50], ['EXO', '출애굽기', 40], ['LEV', '레위기', 27], ['NUM', '민수기', 36], ['DEU', '신명기', 34],
  ['JOS', '여호수아', 24], ['JDG', '사사기', 21], ['RUT', '룻기', 4], ['1SA', '사무엘상', 31], ['2SA', '사무엘하', 24],
  ['1KI', '열왕기상', 22], ['2KI', '열왕기하', 25], ['1CH', '역대상', 29], ['2CH', '역대하', 36], ['EZR', '에스라', 10],
  ['NEH', '느헤미야', 13], ['EST', '에스더', 10], ['JOB', '욥기', 42], ['PSA', '시편', 150], ['PRO', '잠언', 31],
  ['ECC', '전도서', 12], ['SNG', '아가', 8], ['ISA', '이사야', 66], ['JER', '예레미야', 52], ['LAM', '예레미야애가', 5],
  ['EZK', '에스겔', 48], ['DAN', '다니엘', 12], ['HOS', '호세아', 14], ['JOL', '요엘', 3], ['AMO', '아모스', 9],
  ['OBA', '오바댜', 1], ['JON', '요나', 4], ['MIC', '미가', 7], ['NAM', '나훔', 3], ['HAB', '하박국', 3],
  ['ZEP', '스바냐', 3], ['HAG', '학개', 2], ['ZEC', '스가랴', 14], ['MAL', '말라기', 4], ['MAT', '마태복음', 28],
  ['MRK', '마가복음', 16], ['LUK', '누가복음', 24], ['JHN', '요한복음', 21], ['ACT', '사도행전', 28], ['ROM', '로마서', 16],
  ['1CO', '고린도전서', 16], ['2CO', '고린도후서', 13], ['GAL', '갈라디아서', 6], ['EPH', '에베소서', 6], ['PHP', '빌립보서', 4],
  ['COL', '골로새서', 4], ['1TH', '데살로니가전서', 5], ['2TH', '데살로니가후서', 3], ['1TI', '디모데전서', 6], ['2TI', '디모데후서', 4],
  ['TIT', '디도서', 3], ['PHM', '빌레몬서', 1], ['HEB', '히브리서', 13], ['JAS', '야고보서', 5], ['1PE', '베드로전서', 5],
  ['2PE', '베드로후서', 3], ['1JN', '요한일서', 5], ['2JN', '요한이서', 1], ['3JN', '요한삼서', 1], ['JUD', '유다서', 1],
  ['REV', '요한계시록', 22],
];

const OSIS_CODES = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev',
];

const { bcv_parser } = await import(pathToFileURL(join(bcvEsmDir, 'bcv_parser.js')).href);
const korean = await import(pathToFileURL(join(bcvEsmDir, 'lang', 'ko.js')).href);
const defaultVerseCounts = new bcv_parser(korean).translation_info('default').chapters;

const structuralToken = /\\(c|s1|s2|pmo|pmc|pmr|pm|pi\d*|ph\d*|li\d*|nb|pc|pr|po|mi|qa|p|m|b|v)(?=\s|\\|$)(?:\s+([^\\\s]+))?/g;

function lengthOf(range) {
  return range.end - range.start + 1;
}

function normalizeRanges(starts, lastVerse, firstVerse = 1) {
  const cleanStarts = [...new Set([firstVerse, ...starts])]
    .filter((value) => Number.isInteger(value) && value >= firstVerse && value <= lastVerse)
    .sort((a, b) => a - b);

  const editorial = cleanStarts.map((start, index) => ({
    start,
    end: index + 1 < cleanStarts.length ? cleanStarts[index + 1] - 1 : lastVerse,
  }));

  const split = [];
  for (const range of editorial) {
    const length = lengthOf(range);
    if (length <= 18) {
      split.push(range);
      continue;
    }

    const parts = Math.ceil(length / 14);
    const size = Math.ceil(length / parts);
    for (let start = range.start; start <= range.end; start += size) {
      split.push({ start, end: Math.min(range.end, start + size - 1) });
    }
  }

  const merged = [];
  for (const range of split) {
    const previous = merged.at(-1);
    if (lengthOf(range) < 3 && previous && lengthOf(previous) + lengthOf(range) <= 16) {
      previous.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }

  if (merged.length > 1 && lengthOf(merged[0]) < 3 && lengthOf(merged[0]) + lengthOf(merged[1]) <= 16) {
    merged[1].start = merged[0].start;
    merged.shift();
  }

  return merged.map((range) => range.end);
}

function parseUsfm(text, promoteSubsections = false) {
  const chapters = [];
  let chapter = 0;
  let sectionStarts = [];
  let secondaryStarts = [];
  let lastVerse = 0;
  let sectionPending = false;
  let secondaryPending = false;

  const finishChapter = () => {
    if (!chapter || !lastVerse) return;
    const starts = [...new Set([1, ...sectionStarts])].filter((verse) => verse <= lastVerse).sort((a, b) => a - b);
    const ends = [];
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1] - 1 : lastVerse;
      if (end - start + 1 <= 22) {
        ends.push(end);
        return;
      }
      const helpers = secondaryStarts.filter((verse) => verse > start && verse <= end);
      ends.push(...normalizeRanges([start, ...helpers], end, start));
    });
    chapters[chapter - 1] = ends;
  };

  for (const match of text.matchAll(structuralToken)) {
    const marker = match[1];
    const value = match[2];
    if (marker === 'c') {
      finishChapter();
      chapter = Number(value);
      sectionStarts = [];
      secondaryStarts = [];
      lastVerse = 0;
      sectionPending = false;
      secondaryPending = false;
      continue;
    }

    if (!chapter) continue;
    if (marker === 's1' || (marker === 's2' && promoteSubsections)) {
      sectionPending = true;
      continue;
    }
    if (marker !== 'v') {
      secondaryPending = true;
      continue;
    }

    const [startText, endText] = value.split('-');
    const verseStart = Number(startText);
    const verseEnd = Number(endText ?? startText);
    if (sectionPending) sectionStarts.push(verseStart);
    if (secondaryPending) secondaryStarts.push(verseStart);
    sectionPending = false;
    secondaryPending = false;
    lastVerse = Math.max(lastVerse, verseEnd);
  }

  finishChapter();
  return chapters;
}

const files = readdirSync(sourceDir).filter((file) => file.endsWith('.usfm'));
const usfmByCode = new Map();
for (const file of files) {
  const text = readFileSync(join(sourceDir, file), 'utf8');
  const code = text.match(/^\\id\s+([A-Z0-9]{3})/m)?.[1];
  if (code) usfmByCode.set(code, text);
}

const structure = {};
let parsedChapterCount = 0;
for (const [bookIndex, [code, koreanName, expectedChapters]] of BOOKS.entries()) {
  const text = usfmByCode.get(code);
  if (!text) throw new Error(`Missing USFM book: ${code}`);
  const chapters = parseUsfm(text, code === 'GEN' || code === 'PRO');
  if (chapters.length !== expectedChapters || chapters.some((chapterEnds) => !chapterEnds?.length)) {
    throw new Error(`${code} chapter parse mismatch: expected ${expectedChapters}, received ${chapters.length}`);
  }

  const referenceCounts = defaultVerseCounts?.[OSIS_CODES[bookIndex]];
  if (referenceCounts) {
    if (referenceCounts.length !== expectedChapters) throw new Error(`${code} reference chapter count mismatch`);
    referenceCounts.forEach((lastVerse, chapterIndex) => {
      const sourceLastVerse = chapters[chapterIndex].at(-1);
      if (sourceLastVerse === lastVerse) return;
      if (lastVerse > sourceLastVerse) {
        chapters[chapterIndex][chapters[chapterIndex].length - 1] = lastVerse;
        return;
      }
      chapters[chapterIndex] = chapters[chapterIndex].filter((end) => end < lastVerse);
      chapters[chapterIndex].push(lastVerse);
    });
  }

  structure[koreanName] = chapters;
  parsedChapterCount += chapters.length;
}

if (parsedChapterCount !== 1189) {
  throw new Error(`Bible chapter count mismatch: expected 1189, received ${parsedChapterCount}`);
}

const lines = [
  '// Verse limits use the default versification data from the MIT-licensed Bible Passage Reference Parser.',
  '// Reading-unit boundaries follow the public-domain Berean Standard Bible v5.9 USFM section markers.',
  '// Only numeric structure is retained; no Bible text is included.',
  '// Sources: https://github.com/openbibleinfo/Bible-Passage-Reference-Parser',
  '//          https://github.com/BSB-publishing/bsb2usfm/releases/tag/v5.9',
  '',
  'export type PassageUnit = { start: number; end: number };',
  '',
  'const PASSAGE_ENDS: Record<string, number[][]> = {',
  ...Object.entries(structure).map(([name, chapters]) => `  ${JSON.stringify(name)}: ${JSON.stringify(chapters)},`),
  '};',
  '',
  'export function getVerseCount(bookName: string, chapter: number): number {',
  '  const ends = PASSAGE_ENDS[bookName]?.[chapter - 1];',
  '  if (!ends?.length) throw new Error(`Unknown Bible passage: ${bookName} ${chapter}`);',
  '  return ends[ends.length - 1];',
  '}',
  '',
  'export function getPassageUnits(bookName: string, chapter: number): PassageUnit[] {',
  '  const ends = PASSAGE_ENDS[bookName]?.[chapter - 1];',
  '  if (!ends?.length) throw new Error(`Unknown Bible passage: ${bookName} ${chapter}`);',
  '  let start = 1;',
  '  return ends.map((end) => {',
  '    const unit = { start, end };',
  '    start = end + 1;',
  '    return unit;',
  '  });',
  '}',
  '',
];

writeFileSync(outputFile, `${lines.join('\n')}\n`, 'utf8');
const verseLimits = Object.fromEntries(Object.entries(structure).map(([name, chapters]) => [name, chapters.map((ends) => ends.at(-1))]));
writeFileSync(limitsOutputFile, `${JSON.stringify(verseLimits)}\n`, 'utf8');
console.log(`Generated ${outputFile} and ${limitsOutputFile} for ${Object.keys(structure).length} books and ${parsedChapterCount} chapters.`);
