import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('사용법: node scripts/import-korean-bible.mjs <playx-bible.json>');
  process.exit(1);
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(projectRoot, 'public', 'bible', 'playx');
const limits = JSON.parse(await readFile(join(projectRoot, 'scripts', 'bible-limits.json'), 'utf8'));
const sourceCommit = '422073daf8d0dbe56ce8a65bbfe236aa8ddd933a';
const expectedSourceSha256 = '55c092eae0dc0cde2711018b6b2c46e9b0902993b5f597987584d92d58486fd7';
const codes = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SOL', 'ISA', 'JER', 'LAM', 'EZE', 'DAN', 'HOS', 'JOE', 'AMO', 'OBA', 'JON', 'MIC', 'NAH', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MAR', 'LUK', 'JOH', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHI', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAM', '1PE', '2PE', '1JO', '2JO', '3JO', 'JUD', 'REV',
];
const abbreviations = [
  '창', '출', '레', '민', '신', '수', '삿', '룻', '삼상', '삼하', '왕상', '왕하', '대상', '대하', '스', '느', '에', '욥', '시', '잠', '전', '아', '사', '렘', '애', '겔', '단', '호', '욜', '암', '옵', '욘', '미', '나', '합', '습', '학', '슥', '말', '마', '막', '눅', '요', '행', '롬', '고전', '고후', '갈', '엡', '빌', '골', '살전', '살후', '딤전', '딤후', '딛', '몬', '히', '약', '벧전', '벧후', '요일', '요이', '요삼', '유', '계',
];
const expectedExtraKeys = [
  '대상16:12-13', '행15:25-26', '겔24:4-5', '렘32:3-5', '렘33:10-11', '요18:이', '시92:1-3',
  '시105:5-6', '롬9:1-2', '신6:18-19', '신15:4-5', '신30:9-10', '아6:14',
];
const names = Object.keys(limits);

if (codes.length !== 66 || abbreviations.length !== 66 || names.length !== 66) {
  throw new Error(`66권 목록이 일치하지 않습니다: 코드 ${codes.length}, 약어 ${abbreviations.length}, 이름 ${names.length}`);
}

const resolvedSource = resolve(sourcePath);
const sourceBuffer = await readFile(resolvedSource);
const sourceSha256 = createHash('sha256').update(sourceBuffer).digest('hex');
if (sourceSha256 !== expectedSourceSha256) {
  throw new Error(`PLAY X 고정 원본과 SHA-256이 다릅니다.\n기대값: ${expectedSourceSha256}\n실제값: ${sourceSha256}`);
}
const source = JSON.parse(sourceBuffer.toString('utf8'));
await mkdir(outputDir, { recursive: true });

let verseCount = 0;
const usedKeys = new Set();

for (const [bookIndex, name] of names.entries()) {
  const chapters = [];
  const expectedChapters = limits[name];

  for (let chapter = 1; chapter <= expectedChapters.length; chapter += 1) {
    const verses = [];
    for (let verse = 1; verse <= expectedChapters[chapter - 1]; verse += 1) {
      const key = `${abbreviations[bookIndex]}${chapter}:${verse}`;
      const text = source[key];
      if (typeof text !== 'string' || !text.trim()) throw new Error(`본문이 비어 있습니다: ${key}`);
      verses.push(text.replace(/\s+/g, ' ').trim());
      usedKeys.add(key);
      verseCount += 1;
    }
    chapters.push(verses);
  }

  await writeFile(join(outputDir, `${codes[bookIndex]}.json`), `${JSON.stringify({
    book: name,
    code: codes[bookIndex],
    translation: 'PLAY X 성경',
    license: 'CC BY 4.0',
    attribution: 'PLAY X 번역(플레이엑스) · 번역: 김무송 · CC BY 4.0',
    chapters,
  })}\n`, 'utf8');
}

const extraKeys = Object.keys(source).filter((key) => !usedKeys.has(key));
if (JSON.stringify([...extraKeys].sort()) !== JSON.stringify([...expectedExtraKeys].sort())) {
  throw new Error(`고정 원본의 비표준 키 목록이 다릅니다.\n기대값: ${expectedExtraKeys.join(', ')}\n실제값: ${extraKeys.join(', ')}`);
}
await writeFile(join(outputDir, 'index.json'), `${JSON.stringify({
  translation: 'PLAY X 성경',
  koreanTitle: 'PLAY X 성경 - 현대 한국어 공개 번역',
  license: 'CC BY 4.0',
  attribution: 'PLAY X 번역(플레이엑스) · 번역: 김무송 · CC BY 4.0',
  source: `https://github.com/PLAYX1/playx-bible/tree/${sourceCommit}`,
  sourceCommit,
  sourceSha256,
  modifications: '절 좌표를 표준 66권·1,189장 구조로 분할하고 절 안의 줄바꿈만 공백으로 정규화했습니다. 본문 문구는 바꾸지 않았습니다.',
  books: codes.map((code, index) => ({ code, name: names[index], abbreviation: abbreviations[index] })),
  chapterCount: 1189,
  verseCount,
  ignoredNonCanonicalSourceKeys: extraKeys,
}, null, 2)}\n`, 'utf8');

console.log(`검증된 현대 한국어 공개 성경 ${codes.length}권, 1,189장, ${verseCount.toLocaleString('ko-KR')}절을 ${outputDir}에 만들었습니다.`);
