import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = Object.freeze({
  bookCount: 66,
  chapterCount: 1189,
  verseCount: 31103,
  translation: 'PLAY X 성경',
  koreanTitle: 'PLAY X 성경 - 현대 한국어 공개 번역',
  license: 'CC BY 4.0',
  attribution: 'PLAY X 번역(플레이엑스) · 번역: 김무송 · CC BY 4.0',
  sourceCommit: '422073daf8d0dbe56ce8a65bbfe236aa8ddd933a',
  sourceSha256: '55c092eae0dc0cde2711018b6b2c46e9b0902993b5f597987584d92d58486fd7',
  modifications: '절 좌표를 표준 66권·1,189장 구조로 분할하고 절 안의 줄바꿈만 공백으로 정규화했습니다. 본문 문구는 바꾸지 않았습니다.',
});

const BOOK_CODES = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SOL', 'ISA', 'JER', 'LAM', 'EZE', 'DAN', 'HOS', 'JOE', 'AMO', 'OBA', 'JON', 'MIC', 'NAH', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MAR', 'LUK', 'JOH', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHI', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAM', '1PE', '2PE', '1JO', '2JO', '3JO', 'JUD', 'REV',
];

const BOOK_ABBREVIATIONS = [
  '창', '출', '레', '민', '신', '수', '삿', '룻', '삼상', '삼하', '왕상', '왕하', '대상', '대하', '스', '느', '에', '욥', '시', '잠', '전', '아', '사', '렘', '애', '겔', '단', '호', '욜', '암', '옵', '욘', '미', '나', '합', '습', '학', '슥', '말', '마', '막', '눅', '요', '행', '롬', '고전', '고후', '갈', '엡', '빌', '골', '살전', '살후', '딤전', '딤후', '딛', '몬', '히', '약', '벧전', '벧후', '요일', '요이', '요삼', '유', '계',
];

const IGNORED_NON_CANONICAL_SOURCE_KEYS = [
  '대상16:12-13',
  '행15:25-26',
  '겔24:4-5',
  '렘32:3-5',
  '렘33:10-11',
  '요18:이',
  '시92:1-3',
  '시105:5-6',
  '롬9:1-2',
  '신6:18-19',
  '신15:4-5',
  '신30:9-10',
  '아6:14',
];

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const corpusDir = join(projectRoot, 'public', 'bible', 'playx');
const limitsPath = join(projectRoot, 'scripts', 'bible-limits.json');
const indexPath = join(corpusDir, 'index.json');

function verify(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`파일을 읽을 수 없습니다: ${path}\n${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`JSON 형식이 올바르지 않습니다: ${path}\n${error.message}`);
  }
}

function verifyScalarMetadata(target, expectedFields, location) {
  for (const [field, expectedValue] of Object.entries(expectedFields)) {
    verify(
      target[field] === expectedValue,
      `${location}.${field} 값이 다릅니다. 기대값: ${JSON.stringify(expectedValue)}, 실제값: ${JSON.stringify(target[field])}`,
    );
  }
}

function verifyIgnoredKeys(actualKeys) {
  verify(Array.isArray(actualKeys), 'index.ignoredNonCanonicalSourceKeys가 배열이 아닙니다.');
  verify(
    actualKeys.length === IGNORED_NON_CANONICAL_SOURCE_KEYS.length,
    `기록된 비정상 원본 키 수가 다릅니다. 기대값: ${IGNORED_NON_CANONICAL_SOURCE_KEYS.length}, 실제값: ${actualKeys.length}`,
  );
  verify(
    actualKeys.every((key) => typeof key === 'string'),
    'index.ignoredNonCanonicalSourceKeys에는 문자열만 있어야 합니다.',
  );
  verify(
    new Set(actualKeys).size === actualKeys.length,
    'index.ignoredNonCanonicalSourceKeys에 중복 값이 있습니다.',
  );

  const expected = [...IGNORED_NON_CANONICAL_SOURCE_KEYS].sort();
  const actual = [...actualKeys].sort();
  verify(
    JSON.stringify(actual) === JSON.stringify(expected),
    `비정상 원본 키 기록이 다릅니다.\n기대값: ${expected.join(', ')}\n실제값: ${actual.join(', ')}`,
  );
}

async function main() {
  verify(BOOK_CODES.length === EXPECTED.bookCount, `검증 도구의 책 코드 수가 ${EXPECTED.bookCount}개가 아닙니다.`);
  verify(BOOK_ABBREVIATIONS.length === EXPECTED.bookCount, `검증 도구의 책 약어 수가 ${EXPECTED.bookCount}개가 아닙니다.`);

  const [limits, index, directoryEntries] = await Promise.all([
    readJson(limitsPath),
    readJson(indexPath),
    readdir(corpusDir, { withFileTypes: true }),
  ]);

  verify(limits && typeof limits === 'object' && !Array.isArray(limits), 'bible-limits.json의 최상위 값이 객체가 아닙니다.');
  verify(index && typeof index === 'object' && !Array.isArray(index), 'index.json의 최상위 값이 객체가 아닙니다.');

  const bookNames = Object.keys(limits);
  verify(bookNames.length === EXPECTED.bookCount, `절 한계 데이터의 책 수가 다릅니다. 기대값: ${EXPECTED.bookCount}, 실제값: ${bookNames.length}`);

  let expectedChapterCount = 0;
  let expectedVerseCount = 0;
  for (const bookName of bookNames) {
    const chapterLimits = limits[bookName];
    verify(Array.isArray(chapterLimits), `${bookName}의 장별 절 한계가 배열이 아닙니다.`);
    verify(chapterLimits.length > 0, `${bookName}에 장 정보가 없습니다.`);

    for (const [chapterIndex, verseLimit] of chapterLimits.entries()) {
      verify(
        Number.isInteger(verseLimit) && verseLimit > 0,
        `${bookName} ${chapterIndex + 1}장의 절 수가 양의 정수가 아닙니다: ${JSON.stringify(verseLimit)}`,
      );
      expectedVerseCount += verseLimit;
    }
    expectedChapterCount += chapterLimits.length;
  }

  verify(expectedChapterCount === EXPECTED.chapterCount, `절 한계 데이터의 장 수가 다릅니다. 기대값: ${EXPECTED.chapterCount}, 실제값: ${expectedChapterCount}`);
  verify(expectedVerseCount === EXPECTED.verseCount, `절 한계 데이터의 절 수가 다릅니다. 기대값: ${EXPECTED.verseCount}, 실제값: ${expectedVerseCount}`);

  const expectedSource = `https://github.com/PLAYX1/playx-bible/tree/${EXPECTED.sourceCommit}`;
  verifyScalarMetadata(index, {
    translation: EXPECTED.translation,
    koreanTitle: EXPECTED.koreanTitle,
    license: EXPECTED.license,
    attribution: EXPECTED.attribution,
    source: expectedSource,
    sourceCommit: EXPECTED.sourceCommit,
    sourceSha256: EXPECTED.sourceSha256,
    modifications: EXPECTED.modifications,
    chapterCount: EXPECTED.chapterCount,
    verseCount: EXPECTED.verseCount,
  }, 'index');
  verifyIgnoredKeys(index.ignoredNonCanonicalSourceKeys);

  verify(Array.isArray(index.books), 'index.books가 배열이 아닙니다.');
  verify(index.books.length === EXPECTED.bookCount, `index.books 수가 다릅니다. 기대값: ${EXPECTED.bookCount}, 실제값: ${index.books.length}`);

  const actualJsonFiles = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  const expectedJsonFiles = ['index.json', ...BOOK_CODES.map((code) => `${code}.json`)].sort();
  verify(
    JSON.stringify(actualJsonFiles) === JSON.stringify(expectedJsonFiles),
    `본문 JSON 파일 구성이 다릅니다.\n기대값: ${expectedJsonFiles.join(', ')}\n실제값: ${actualJsonFiles.join(', ')}`,
  );

  let actualChapterCount = 0;
  let actualVerseCount = 0;

  for (let bookIndex = 0; bookIndex < EXPECTED.bookCount; bookIndex += 1) {
    const code = BOOK_CODES[bookIndex];
    const name = bookNames[bookIndex];
    const abbreviation = BOOK_ABBREVIATIONS[bookIndex];
    const chapterLimits = limits[name];
    const indexBook = index.books[bookIndex];

    verify(indexBook && typeof indexBook === 'object' && !Array.isArray(indexBook), `index.books[${bookIndex}]가 객체가 아닙니다.`);
    verifyScalarMetadata(indexBook, { code, name, abbreviation }, `index.books[${bookIndex}]`);

    const bookPath = join(corpusDir, `${code}.json`);
    const book = await readJson(bookPath);
    verify(book && typeof book === 'object' && !Array.isArray(book), `${code}.json의 최상위 값이 객체가 아닙니다.`);
    verifyScalarMetadata(book, {
      book: name,
      code,
      translation: EXPECTED.translation,
      license: EXPECTED.license,
      attribution: EXPECTED.attribution,
    }, code);

    verify(Array.isArray(book.chapters), `${code}.chapters가 배열이 아닙니다.`);
    verify(
      book.chapters.length === chapterLimits.length,
      `${name}의 장 수가 다릅니다. 기대값: ${chapterLimits.length}, 실제값: ${book.chapters.length}`,
    );

    for (let chapterIndex = 0; chapterIndex < chapterLimits.length; chapterIndex += 1) {
      const verses = book.chapters[chapterIndex];
      const expectedVerses = chapterLimits[chapterIndex];
      verify(Array.isArray(verses), `${name} ${chapterIndex + 1}장의 본문이 배열이 아닙니다.`);
      verify(
        verses.length === expectedVerses,
        `${name} ${chapterIndex + 1}장의 절 수가 다릅니다. 기대값: ${expectedVerses}, 실제값: ${verses.length}`,
      );

      for (let verseIndex = 0; verseIndex < verses.length; verseIndex += 1) {
        const text = verses[verseIndex];
        const reference = `${name} ${chapterIndex + 1}:${verseIndex + 1}`;
        verify(typeof text === 'string', `${reference} 본문이 문자열이 아닙니다.`);
        verify(text.trim().length > 0, `${reference} 본문이 비어 있습니다.`);
      }

      actualChapterCount += 1;
      actualVerseCount += verses.length;
    }
  }

  verify(actualChapterCount === EXPECTED.chapterCount, `본문의 총 장 수가 다릅니다. 기대값: ${EXPECTED.chapterCount}, 실제값: ${actualChapterCount}`);
  verify(actualVerseCount === EXPECTED.verseCount, `본문의 총 절 수가 다릅니다. 기대값: ${EXPECTED.verseCount}, 실제값: ${actualVerseCount}`);

  console.log(`PLAY X 본문 검증 성공: ${EXPECTED.bookCount}권 · ${actualChapterCount.toLocaleString('ko-KR')}장 · ${actualVerseCount.toLocaleString('ko-KR')}절 · 빈 본문 0절 · 제외 원본 키 ${IGNORED_NON_CANONICAL_SOURCE_KEYS.length}개`);
  console.log(`원본: ${EXPECTED.sourceCommit} · SHA-256 ${EXPECTED.sourceSha256}`);
}

main().catch((error) => {
  console.error('PLAY X 본문 검증 실패');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
