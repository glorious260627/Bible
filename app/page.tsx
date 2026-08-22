'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getPassageUnits, getVerseCount } from './bible-structure';
import proverbsOneSermon from './sermons/proverbs-1-sermon.json';

type BookGroup = '율법서' | '역사서' | '시가서' | '예언서' | '복음서' | '사도행전' | '서신서' | '요한계시록';
type Book = { name: string; short: string; chapters: number; testament: '구약' | '신약'; group: BookGroup; theme: string };
type Sermon = {
  title: string;
  summary: string;
  opening: string;
  context: string;
  passageSections: { start: number; end: number; title: string; explanation: string }[];
  points: { title: string; body: string }[];
  illustration: string;
  crossReferences: { reference: string; connection: string }[];
  applications: string[];
  caution: string;
  questions: string[];
  decision: string;
  prayer: string;
  manuscript: {
    estimatedMinutes: number;
    introduction: string[];
    sections: {
      start: number;
      end: number;
      heading: string;
      paragraphs: string[];
      bridgeToNext: string;
    }[];
    gospelConnection: string[];
    conclusion: string[];
    closingPrayer: string;
  };
};
type ChatMessage = { role: 'user' | 'guide'; text: string };
type CareTopic = {
  id: string;
  label: string;
  keywords: string[];
  book: string;
  chapter: number;
  start: number;
  end: number;
  reason: string;
  care: string;
  firstStep: string;
};
type Urgency = 'self_harm' | 'violence' | 'both' | 'harm_to_others' | 'complex_danger' | null;
type CareResult = { topic: CareTopic; urgent: Urgency };
type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused';
type TtsTarget = 'scripture' | 'sermon';
type MobileTab = 'bible' | 'sermon' | 'heart' | 'question';

function getNativeTextToSpeech() {
  return import('@capacitor-community/text-to-speech');
}

async function prepareNativeKoreanVoice() {
  const { TextToSpeech } = await getNativeTextToSpeech();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { supported } = await TextToSpeech.isLanguageSupported({ lang: 'ko-KR' }).catch(() => ({ supported: false }));
    if (supported) return { TextToSpeech, supported: true as const };
    await new Promise((resolve) => window.setTimeout(resolve, 180));
  }
  return { TextToSpeech, supported: false as const };
}
type PassageStatus = 'loading' | 'ready' | 'error';
type PassageVerse = { number: number; text: string };
type BibleBookFile = { book: string; code: string; chapters: string[][] };
type LocalAiPayload = { topicId: string; urgent: 'none' | Exclude<Urgency, null>; sermon: Sermon };
type LocalAiConnection = { baseUrl: string; token: string };
type LocalGenerationResponse = { ok: boolean; status: number; data: unknown };
type LocalAiStatus = 'unconfigured' | 'checking' | 'connected' | 'offline';
type GenerationIssueKind = 'not-configured' | 'unauthorized' | 'timeout' | 'offline' | 'invalid';
type GenerationIssue = { ref: string; kind: GenerationIssueKind; message: string };

const LOCAL_AI_PORT = process.env.NEXT_PUBLIC_BIBLE_LOCAL_AI_PORT || '4317';
const DEFAULT_LOCAL_AI_TOKEN = process.env.NEXT_PUBLIC_BIBLE_LOCAL_TOKEN || '';
const DEFAULT_LOCAL_AI_BASE = process.env.NEXT_PUBLIC_BIBLE_LOCAL_AI_BASE || `http://127.0.0.1:${LOCAL_AI_PORT}`;
const LOCAL_AI_STORAGE_KEY = 'word-guide-local-ai';
const SERMON_CACHE_KEY = 'word-guide-generated-sermons-v2';
const SERMON_CACHE_VERSION = 2;

function normalizedLocalAiBase(value: string) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('invalid_local_ai_url');
  return parsed.toString().replace(/\/$/, '');
}

async function requestLocalAiHealth(connection: LocalAiConnection) {
  const baseUrl = normalizedLocalAiBase(connection.baseUrl);
  const headers = { 'X-Bible-Local-Token': connection.token };
  if (Capacitor.isNativePlatform()) {
    return (await CapacitorHttp.get({ url: `${baseUrl}/health`, headers, connectTimeout: 8_000, readTimeout: 8_000 })).status;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    return (await fetch(`${baseUrl}/health`, { headers, cache: 'no-store', signal: controller.signal })).status;
  } finally {
    window.clearTimeout(timeout);
  }
}

function describeGenerationIssue(error: unknown, selectedReference: string): GenerationIssue {
  const message = error instanceof Error ? error.message : String(error);
  if (/_(401|403)$/.test(message)) {
    return { ref: selectedReference, kind: 'unauthorized', message: '앱과 PC의 연결 코드가 서로 달라요. 새 APK에 PC 연결 정보를 다시 넣어야 합니다.' };
  }
  if ((error instanceof DOMException && error.name === 'AbortError') || message.includes('timeout') || message.includes('aborted')) {
    return { ref: selectedReference, kind: 'timeout', message: 'PC 코덱스가 제한 시간 안에 설교를 완성하지 못했어요. 잠시 뒤 다시 만들 수 있어요.' };
  }
  if (message.includes('invalid_') || /_(400|500)$/.test(message)) {
    return { ref: selectedReference, kind: 'invalid', message: 'PC에는 연결됐지만 완성된 설교가 품질 검사를 통과하지 못했어요. 임시 글로 대신하지 않고 다시 만들도록 했어요.' };
  }
  return { ref: selectedReference, kind: 'offline', message: 'PC의 말씀 서버에 닿지 않았어요. PC와 휴대폰이 같은 와이파이인지, PC 서버가 켜져 있는지 확인해 주세요.' };
}

const BOOKS: Book[] = [
  { name: '창세기', short: '창', chapters: 50, testament: '구약', group: '율법서', theme: '창조, 인간의 깨어짐, 약속과 믿음의 시작' },
  { name: '출애굽기', short: '출', chapters: 40, testament: '구약', group: '율법서', theme: '억압에서의 해방과 언약 백성의 형성' },
  { name: '레위기', short: '레', chapters: 27, testament: '구약', group: '율법서', theme: '거룩하신 하나님과 함께 사는 예배의 질서' },
  { name: '민수기', short: '민', chapters: 36, testament: '구약', group: '율법서', theme: '광야의 실패 속에서도 이어지는 하나님의 신실하심' },
  { name: '신명기', short: '신', chapters: 34, testament: '구약', group: '율법서', theme: '다음 세대에게 다시 들려주는 언약과 사랑' },
  { name: '여호수아', short: '수', chapters: 24, testament: '구약', group: '역사서', theme: '약속의 땅에서 하나님을 선택하는 책임' },
  { name: '사사기', short: '삿', chapters: 21, testament: '구약', group: '역사서', theme: '자기 소견대로 살 때 반복되는 혼란과 구원' },
  { name: '룻기', short: '룻', chapters: 4, testament: '구약', group: '역사서', theme: '평범한 충성과 환대 속에서 일하시는 하나님' },
  { name: '사무엘상', short: '삼상', chapters: 31, testament: '구약', group: '역사서', theme: '겉모습이 아닌 중심을 보시는 하나님과 왕의 책임' },
  { name: '사무엘하', short: '삼하', chapters: 24, testament: '구약', group: '역사서', theme: '다윗 왕국의 은혜와 권력의 죄, 회개의 필요' },
  { name: '열왕기상', short: '왕상', chapters: 22, testament: '구약', group: '역사서', theme: '왕과 백성의 선택이 공동체에 남기는 열매' },
  { name: '열왕기하', short: '왕하', chapters: 25, testament: '구약', group: '역사서', theme: '불순종의 결과와 무너지지 않는 하나님의 약속' },
  { name: '역대상', short: '대상', chapters: 29, testament: '구약', group: '역사서', theme: '예배 공동체의 뿌리와 다윗에게 주신 약속' },
  { name: '역대하', short: '대하', chapters: 36, testament: '구약', group: '역사서', theme: '성전과 왕들의 개혁, 돌이킴의 기회' },
  { name: '에스라', short: '스', chapters: 10, testament: '구약', group: '역사서', theme: '포로 귀환 뒤 말씀과 예배를 다시 세우는 공동체' },
  { name: '느헤미야', short: '느', chapters: 13, testament: '구약', group: '역사서', theme: '무너진 성벽과 공동체를 함께 다시 세우는 리더십' },
  { name: '에스더', short: '에', chapters: 10, testament: '구약', group: '역사서', theme: '하나님이 보이지 않는 때에도 이어지는 섭리와 용기' },
  { name: '욥기', short: '욥', chapters: 42, testament: '구약', group: '시가서', theme: '설명되지 않는 고난 앞의 정직한 질문과 믿음' },
  { name: '시편', short: '시', chapters: 150, testament: '구약', group: '시가서', theme: '기쁨과 분노와 슬픔까지 하나님께 가져가는 기도' },
  { name: '잠언', short: '잠', chapters: 31, testament: '구약', group: '시가서', theme: '하나님을 경외하며 일상을 지혜롭게 사는 법' },
  { name: '전도서', short: '전', chapters: 12, testament: '구약', group: '시가서', theme: '성취의 한계를 인정하며 선물로 받는 오늘' },
  { name: '아가', short: '아', chapters: 8, testament: '구약', group: '시가서', theme: '사랑의 기쁨과 존중, 관계의 아름다움' },
  { name: '이사야', short: '사', chapters: 66, testament: '구약', group: '예언서', theme: '거룩하신 하나님의 심판과 위로, 새 창조의 소망' },
  { name: '예레미야', short: '렘', chapters: 52, testament: '구약', group: '예언서', theme: '무너지는 시대에 전하는 눈물의 경고와 새 언약' },
  { name: '예레미야애가', short: '애', chapters: 5, testament: '구약', group: '예언서', theme: '폐허 속에서 슬픔을 숨기지 않고 기다리는 소망' },
  { name: '에스겔', short: '겔', chapters: 48, testament: '구약', group: '예언서', theme: '포로지에서 주시는 새 마음과 회복의 환상' },
  { name: '다니엘', short: '단', chapters: 12, testament: '구약', group: '예언서', theme: '제국 속에서도 정체성을 지키는 믿음과 소망' },
  { name: '호세아', short: '호', chapters: 14, testament: '구약', group: '예언서', theme: '배신을 넘어 다시 부르시는 하나님의 신실한 사랑' },
  { name: '요엘', short: '욜', chapters: 3, testament: '구약', group: '예언서', theme: '재난 속 회개와 모든 이에게 부어지는 하나님의 영' },
  { name: '아모스', short: '암', chapters: 9, testament: '구약', group: '예언서', theme: '예배와 분리할 수 없는 정의와 공의' },
  { name: '오바댜', short: '옵', chapters: 1, testament: '구약', group: '예언서', theme: '이웃의 고통을 이용한 교만에 대한 경고' },
  { name: '요나', short: '욘', chapters: 4, testament: '구약', group: '예언서', theme: '원수에게도 향하는 하나님의 넓은 자비' },
  { name: '미가', short: '미', chapters: 7, testament: '구약', group: '예언서', theme: '정의를 행하고 인애를 사랑하며 겸손히 걷는 삶' },
  { name: '나훔', short: '나', chapters: 3, testament: '구약', group: '예언서', theme: '폭력 제국의 끝과 억눌린 이들을 위한 위로' },
  { name: '하박국', short: '합', chapters: 3, testament: '구약', group: '예언서', theme: '불의한 현실을 질문하며 믿음으로 기다리는 법' },
  { name: '스바냐', short: '습', chapters: 3, testament: '구약', group: '예언서', theme: '심판을 지나 남은 이들과 함께하시는 기쁨' },
  { name: '학개', short: '학', chapters: 2, testament: '구약', group: '예언서', theme: '무너진 예배와 공동체의 우선순위를 다시 세움' },
  { name: '스가랴', short: '슥', chapters: 14, testament: '구약', group: '예언서', theme: '낙심한 공동체에 주시는 회복과 왕의 소망' },
  { name: '말라기', short: '말', chapters: 4, testament: '구약', group: '예언서', theme: '무뎌진 예배를 깨우고 다시 오실 주를 기다림' },
  { name: '마태복음', short: '마', chapters: 28, testament: '신약', group: '복음서', theme: '약속을 이루신 왕 예수와 하나님 나라의 삶' },
  { name: '마가복음', short: '막', chapters: 16, testament: '신약', group: '복음서', theme: '섬기고 고난받는 하나님의 아들 예수' },
  { name: '누가복음', short: '눅', chapters: 24, testament: '신약', group: '복음서', theme: '소외된 이들에게까지 임한 구원과 기쁨' },
  { name: '요한복음', short: '요', chapters: 21, testament: '신약', group: '복음서', theme: '생명을 주시는 하나님의 아들 예수를 믿는 길' },
  { name: '사도행전', short: '행', chapters: 28, testament: '신약', group: '사도행전', theme: '성령께서 경계를 넘어 세우시는 교회' },
  { name: '로마서', short: '롬', chapters: 16, testament: '신약', group: '서신서', theme: '복음이 드러내는 하나님의 의와 새로운 삶' },
  { name: '고린도전서', short: '고전', chapters: 16, testament: '신약', group: '서신서', theme: '갈등하는 교회를 십자가와 사랑으로 바로 세움' },
  { name: '고린도후서', short: '고후', chapters: 13, testament: '신약', group: '서신서', theme: '약함 속에 드러나는 하나님의 능력과 진실한 섬김' },
  { name: '갈라디아서', short: '갈', chapters: 6, testament: '신약', group: '서신서', theme: '은혜로 얻은 자유를 사랑으로 살아내는 삶' },
  { name: '에베소서', short: '엡', chapters: 6, testament: '신약', group: '서신서', theme: '그리스도 안에서 하나 된 새 공동체' },
  { name: '빌립보서', short: '빌', chapters: 4, testament: '신약', group: '서신서', theme: '어려움 속에서도 겸손과 기쁨으로 걷는 길' },
  { name: '골로새서', short: '골', chapters: 4, testament: '신약', group: '서신서', theme: '모든 것 위에 계신 그리스도와 새 사람의 삶' },
  { name: '데살로니가전서', short: '살전', chapters: 5, testament: '신약', group: '서신서', theme: '다시 오실 주를 기다리며 서로 격려하는 공동체' },
  { name: '데살로니가후서', short: '살후', chapters: 3, testament: '신약', group: '서신서', theme: '혼란한 종말 소문 속에서도 흔들리지 않는 일상' },
  { name: '디모데전서', short: '딤전', chapters: 6, testament: '신약', group: '서신서', theme: '건강한 가르침과 책임 있는 교회 돌봄' },
  { name: '디모데후서', short: '딤후', chapters: 4, testament: '신약', group: '서신서', theme: '어려움 속에서도 복음에 충실한 다음 세대' },
  { name: '디도서', short: '딛', chapters: 3, testament: '신약', group: '서신서', theme: '바른 믿음이 선한 삶으로 이어지는 교회' },
  { name: '빌레몬서', short: '몬', chapters: 1, testament: '신약', group: '서신서', theme: '복음이 신분의 벽을 넘어 관계를 새롭게 함' },
  { name: '히브리서', short: '히', chapters: 13, testament: '신약', group: '서신서', theme: '더 나은 대제사장 예수를 바라보며 견디는 믿음' },
  { name: '야고보서', short: '약', chapters: 5, testament: '신약', group: '서신서', theme: '듣는 믿음을 말과 행동으로 살아내는 지혜' },
  { name: '베드로전서', short: '벧전', chapters: 5, testament: '신약', group: '서신서', theme: '낯선 세상에서 소망과 선함을 지키는 공동체' },
  { name: '베드로후서', short: '벧후', chapters: 3, testament: '신약', group: '서신서', theme: '거짓 가르침을 분별하며 성숙해 가는 믿음' },
  { name: '요한일서', short: '요일', chapters: 5, testament: '신약', group: '서신서', theme: '하나님의 사랑 안에서 진리와 사랑을 함께 삶' },
  { name: '요한이서', short: '요이', chapters: 1, testament: '신약', group: '서신서', theme: '사랑과 진리를 분리하지 않는 분별' },
  { name: '요한삼서', short: '요삼', chapters: 1, testament: '신약', group: '서신서', theme: '진리를 위해 섬기는 환대와 건강한 리더십' },
  { name: '유다서', short: '유', chapters: 1, testament: '신약', group: '서신서', theme: '왜곡된 가르침 속에서 믿음과 자비를 지킴' },
  { name: '요한계시록', short: '계', chapters: 22, testament: '신약', group: '요한계시록', theme: '제국의 압박 속에서도 어린양을 따르는 소망과 새 창조' },
];

const BIBLE_CODES = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SOL', 'ISA', 'JER', 'LAM', 'EZE', 'DAN', 'HOS', 'JOE', 'AMO', 'OBA', 'JON', 'MIC', 'NAH', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MAR', 'LUK', 'JOH', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHI', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAM', '1PE', '2PE', '1JO', '2JO', '3JO', 'JUD', 'REV',
] as const;

const GROUP_GUIDE: Record<BookGroup, { context: string; lens: string; action: string; caution: string }> = {
  율법서: {
    context: '율법서는 하나님이 한 백성을 부르시고, 자유와 책임과 거룩을 가르치시는 큰 이야기 안에서 읽어야 합니다.',
    lens: '명령 하나만 떼어 오늘에 곧바로 옮기기보다, 그 말씀이 당시 공동체를 어떤 사람들로 빚으려 했는지 먼저 살펴보세요.',
    action: '하나님의 은혜가 먼저였다는 사실을 기억하고, 오늘 내가 자유와 책임을 함께 살아낼 한 가지 행동을 골라보세요.',
    caution: '구약의 모든 규례가 오늘의 그리스도인에게 같은 방식으로 직접 적용되는 것은 아닙니다. 성경 전체와 예수님의 가르침 안에서 살펴야 해요.',
  },
  역사서: {
    context: '역사서는 단순한 영웅담이 아니라, 사람의 선택과 권력이 공동체에 어떤 열매를 남기는지 정직하게 보여 줍니다.',
    lens: '등장인물이 했다는 이유만으로 그 행동을 하나님이 명령하셨다고 보지 말고, 이야기 전체가 그 선택을 어떻게 평가하는지 살펴보세요.',
    action: '내가 가진 작은 권한이 가족·직장·교회에서 누구를 살리고 누구를 어렵게 하는지 돌아보세요.',
    caution: '전쟁과 폭력의 장면을 오늘의 적대나 혐오를 정당화하는 근거로 사용하면 안 됩니다. 당시의 역사적 맥락과 성경 전체의 평화 메시지를 함께 보세요.',
  },
  시가서: {
    context: '시가서는 교리 문장만이 아니라 기도, 노래, 질문, 삶의 지혜로 하나님 앞에 서는 법을 가르칩니다.',
    lens: '감정을 숨기지 않고 가져가되, 한 문장을 모든 상황에 적용되는 공식처럼 만들지 않는 것이 중요합니다.',
    action: '지금 내 마음의 감정을 한 단어로 이름 붙이고, 그 감정을 하나님께 솔직한 문장으로 말씀드려 보세요.',
    caution: '특히 잠언은 삶의 일반적 원리이지 “그대로 하면 반드시 성공한다”는 계약서가 아닙니다. 고난당한 사람을 탓하는 데 사용하지 마세요.',
  },
  예언서: {
    context: '예언서는 미래 암호 풀이보다, 당대의 우상숭배와 불의에 대한 하나님의 경고와 회복의 약속을 먼저 전합니다.',
    lens: '심판의 말 뒤에 어떤 잘못이 있었는지, 그리고 하나님이 어떤 회복을 바라시는지 함께 보세요.',
    action: '개인의 경건만 아니라 우리 사회와 공동체에서 약한 이가 공정하게 대우받는지도 살펴보세요.',
    caution: '현대의 특정 인물이나 사건을 본문 속 심판 대상으로 단정하거나 날짜를 예언하는 방식은 피해야 합니다.',
  },
  복음서: {
    context: '복음서는 예수님의 말씀과 행동, 십자가와 부활을 통해 하나님 나라가 어떤 모습인지 보여 줍니다.',
    lens: '내가 누구와 닮았는지 보기 전에, 이 장면이 예수님을 어떤 분으로 드러내는지 먼저 물어보세요.',
    action: '예수님이 이 장면에서 가까이하신 사람과 오늘 내가 지나치고 있는 사람을 연결해 보세요.',
    caution: '예수님의 말씀을 다른 사람을 정죄하는 자로 쓰기 전에, 먼저 나를 비추고 공동체를 살리는 방향으로 읽어야 합니다.',
  },
  사도행전: {
    context: '사도행전은 성령께서 평범한 사람들을 통해 문화와 민족의 경계를 넘어 교회를 세우시는 이야기입니다.',
    lens: '모든 사건이 반복해야 할 공식인지, 특별한 전환기의 사건인지 구별하며 읽으세요.',
    action: '내가 편한 사람들만 찾고 있지는 않은지 돌아보고, 오늘 한 사람의 이야기를 더 오래 들어보세요.',
    caution: '초대교회의 한 장면을 유일한 교회 운영 방식으로 단정하지 말고, 사도행전 전체의 흐름과 서신서의 가르침을 함께 보세요.',
  },
  서신서: {
    context: '서신서는 실제 문제를 겪던 특정 교회와 사람들에게 보낸 편지입니다. 문장 앞뒤와 수신자의 상황을 함께 보아야 합니다.',
    lens: '“누가, 누구에게, 어떤 문제 때문에 말했는가?”를 먼저 묻고 복음이 그 관계를 어떻게 바꾸는지 살펴보세요.',
    action: '오늘의 관계 하나를 떠올리고, 내 권리를 앞세우기보다 진실과 사랑을 함께 지킬 방법을 적어보세요.',
    caution: '한 구절만 떼어 권위에 대한 무조건적 복종이나 특정 집단의 열등함을 주장하는 데 쓰지 마세요. 편지 전체와 예수님의 섬김을 기준으로 분별해야 합니다.',
  },
  요한계시록: {
    context: '요한계시록은 두려움을 부추기는 암호책이 아니라, 제국의 압박 속에서 믿음을 지키던 교회에 보낸 소망의 묵시입니다.',
    lens: '상징을 오늘의 뉴스 인물과 1:1로 맞추기보다, 누가 참된 왕이며 악의 권력이 어떻게 끝나는지 큰 그림을 보세요.',
    action: '불안 때문에 타협하고 싶은 영역에서, 사랑과 진실을 지키는 작지만 구체적인 선택을 해보세요.',
    caution: '종말의 날짜, 특정 국가·기술·인물을 본문 속 상징으로 단정하지 마세요. 중심은 공포가 아니라 어린양의 승리와 새 창조의 소망입니다.',
  },
};

const CURATED: Record<string, Partial<Sermon>> = {
  '잠언-1-1-33': proverbsOneSermon,
  '잠언-1-1-7': {
    title: '많이 아는 것보다 잘 듣는 것에서 시작됩니다',
    summary: '하나님을 삶의 기준으로 모시고 기꺼이 배우려는 태도가 참된 지혜의 출발점입니다.',
    opening: '요즘은 휴대폰만 열면 몇 초 안에 답을 얻을 수 있어요. 그런데 답을 빨리 찾는 것과 삶을 바르게 선택하는 것은 같은 일이 아닙니다. 오늘 잠언은 “얼마나 많이 아느냐”보다 “누구의 말을 듣고 어떤 기준으로 사느냐”를 먼저 묻습니다.',
    context: '잠언의 첫머리는 이 책이 단순한 성공 비법이나 좋은 문장 모음이 아니라, 일상에서 옳고 그름을 분별하고 성숙하게 선택하도록 훈련하는 말씀임을 알려 줍니다.',
    passageSections: [
      { start: 1, end: 2, title: '지혜를 배우는 책의 문이 열립니다', explanation: '잠언은 지식 자랑이 아니라 지혜와 훈계를 알아듣고 삶을 분별하도록 우리를 훈련합니다. 신앙은 모르는 것을 숨기는 태도가 아니라 기꺼이 배우는 태도에서 시작합니다.' },
      { start: 3, end: 6, title: '지혜는 삶의 판단과 행동으로 이어집니다', explanation: '정의와 공평과 정직을 배우고, 단순한 사람과 젊은 사람도 생각하는 힘을 갖게 하려는 말씀이 이어집니다. 지혜는 정보량이 아니라 사람을 살리는 바른 판단으로 드러납니다.' },
      { start: 7, end: 7, title: '모든 지혜의 출발점은 하나님을 경외하는 마음입니다', explanation: '경외는 겁에 질려 숨는 공포가 아닙니다. 내 욕심과 체면보다 하나님을 더 신뢰하고 존중하며, 그분의 선하심을 삶의 기준으로 삼는 태도입니다.' },
    ],
    points: [
      { title: '1–2절 · 지혜는 배우려는 마음에서 시작해요', body: '잠언은 미래를 맞히는 비밀책이 아니라 삶을 이해하고 훈련받게 하는 책입니다. 지혜로운 사람은 모르는 것을 숨기는 사람이 아니라 기꺼이 배우는 사람이에요.' },
      { title: '3–6절 · 지혜는 정직하고 공정한 행동으로 보여요', body: '정보를 많이 아는 것만으로는 충분하지 않아요. 유리한 상황에서도 무엇이 선한지 살피고, 아는 것을 정직한 행동으로 옮기는 힘이 성경이 말하는 지혜입니다.' },
      { title: '7절 · 경외는 공포가 아니라 신뢰와 존중이에요', body: '벌이 무서워 숨는 태도가 아니라, 내 욕심과 고집보다 하나님의 선하심을 더 중요한 기준으로 삼는 태도에 가깝습니다.' },
    ],
    illustration: '내비게이션은 길을 많이 외우는 사람보다 목적지를 바르게 입력한 사람에게 도움이 됩니다. 지혜도 비슷해요. 능력과 정보가 많아도 삶의 목적지가 욕심과 체면을 향하면 더 빨리 잘못된 곳에 도착할 수 있습니다. 하나님을 경외한다는 말은 삶의 목적지를 하나님의 선하심에 맞추는 일입니다.',
    crossReferences: [
      { reference: '야고보서 1장 5절', connection: '지혜가 부족할 때 하나님께 구하라는 초청으로 이어집니다.' },
      { reference: '마태복음 7장 24절', connection: '예수님도 말씀을 듣고 행하는 사람을 지혜로운 사람이라 부르십니다.' },
    ],
    decision: '오늘 한 번은 바로 말하거나 공유하기 전에 멈추겠습니다. “이 선택이 정직한가, 누군가를 살리는가, 하나님 앞에서 떳떳한가?”를 묻고 행동하겠습니다.',
    caution: '‘어리석다’는 표현은 지능이 낮거나 배우지 못한 사람을 비하하지 않습니다. 교훈과 바른 판단을 완강히 거부하는 태도를 가리켜요. 또한 이 말씀은 사람의 폭언이나 학대를 참고 복종하라는 뜻이 아닙니다.',
  },
  '시편-23-1-6': {
    title: '문제가 사라지기 전에 곁을 발견하는 믿음',
    summary: '시편 23편의 평안은 위험이 없어서가 아니라, 어두운 길에서도 하나님이 함께하신다는 신뢰에서 옵니다.',
    context: '목자와 양의 이미지는 돌봄, 인도, 보호를 보여 줍니다. 시인은 좋은 풀밭만 말하지 않고 깊은 어둠의 골짜기도 함께 말해요.',
    passageSections: [
      { start: 1, end: 3, title: '목자이신 하나님이 쉬게 하고 다시 일으키십니다', explanation: '시인은 필요한 것이 하나도 없다는 과장이 아니라, 하나님이 먹이고 쉬게 하며 지친 영혼을 다시 살리시는 목자라고 고백합니다.' },
      { start: 4, end: 4, title: '어두운 골짜기에서도 혼자가 아닙니다', explanation: '믿음의 길에도 죽음의 그늘 같은 시간이 있습니다. 두려움이 사라지는 근거는 상황이 밝아져서가 아니라 주께서 함께 계시기 때문입니다.' },
      { start: 5, end: 6, title: '위협 한가운데 베푸시는 식탁과 끝까지 따르는 사랑입니다', explanation: '하나님은 원수가 사라진 뒤에만 돌보시는 분이 아닙니다. 불안한 현실 한복판에서도 존엄을 세우시고, 선하심과 인자하심으로 삶의 끝까지 동행하십니다.' },
    ],
  },
  '마태복음-6-25-34': {
    title: '걱정을 꾸짖기보다 오늘을 다시 맡기는 연습',
    summary: '예수님은 현실의 필요를 무시하라고 하지 않고, 걱정이 삶의 주인이 되지 않도록 하나님의 돌보심을 바라보게 하십니다.',
    context: '이 말씀은 하루 벌어 하루 살던 사람들에게 주어진 산상설교의 일부입니다. 가난한 이에게 “걱정하지 마”라고 가볍게 말하는 문장이 아니에요.',
    passageSections: [
      { start: 25, end: 27, title: '생명은 걱정으로 지켜 내는 소유물이 아닙니다', explanation: '예수님은 먹고사는 문제를 하찮게 여기지 않으십니다. 오히려 생명을 주신 하나님이 우리의 필요도 아신다는 사실과, 걱정만으로는 삶을 한 뼘도 늘릴 수 없다는 한계를 보게 하십니다.' },
      { start: 28, end: 30, title: '들의 꽃을 보며 하나님의 세심한 돌보심을 배웁니다', explanation: '수고와 성취로 자신을 증명하지 않는 들꽃도 하나님이 입히십니다. 이 말씀은 노력하지 말라는 뜻이 아니라, 성과와 조건이 내 가치를 결정하도록 내버려 두지 말라는 초대입니다.' },
      { start: 31, end: 34, title: '내일 전체가 아니라 오늘의 순종을 맡깁니다', explanation: '예수님은 필요한 것을 하나님이 이미 아신다고 말씀하시며 먼저 하나님 나라와 의를 구하라고 하십니다. 믿음은 미래를 모조리 통제하는 능력이 아니라 오늘 해야 할 선한 일을 행하고 내일은 하나님께 맡기는 연습입니다.' },
    ],
  },
  '요한복음-3-1-21': {
    title: '정죄보다 먼저 우리에게 다가온 사랑',
    summary: '하나님의 사랑은 멀리서 평가하는 사랑이 아니라, 세상을 살리기 위해 자신을 내어 주신 사랑입니다.',
    context: '밤에 예수님을 찾아온 니고데모와의 대화에서 믿음, 새로 태어남, 하나님의 사랑이 이어집니다. 한 구절만 떼기보다 이 대화 전체를 함께 보세요.',
    passageSections: [
      { start: 1, end: 8, title: '익숙한 종교 지식만으로는 새 생명을 만들 수 없습니다', explanation: '니고데모는 많은 것을 아는 지도자였지만 예수님은 성령으로 새로 태어나는 변화가 필요하다고 말씀하십니다. 믿음은 낡은 삶에 종교 지식을 더하는 일이 아닙니다.' },
      { start: 9, end: 15, title: '하늘에서 오신 예수님을 바라보라는 초대입니다', explanation: '이해하지 못해 묻는 니고데모에게 예수님은 자신이 들려 올려질 것을 말씀하십니다. 구원은 내가 위로 올라가 얻는 성취가 아니라 하나님이 먼저 내려오셔서 여신 길입니다.' },
      { start: 16, end: 21, title: '정죄보다 먼저 세상을 향한 하나님의 사랑이 있습니다', explanation: '하나님이 아들을 보내신 목적은 세상을 무너뜨리는 데 있지 않고 살리는 데 있습니다. 그 사랑을 믿는 사람은 어둠에 숨기보다 진실의 빛으로 나와 삶을 새롭게 합니다.' },
    ],
  },
  '로마서-8-35-39': {
    title: '끊을 수 없는 사랑 안에서 견디는 오늘',
    summary: '성령께서 우리의 연약함을 도우시며, 어떤 현실도 그리스도 안에 있는 하나님의 사랑에서 우리를 끊을 수 없습니다.',
    context: '바울은 고난이 없다고 말하지 않습니다. 탄식하는 피조세계와 연약한 사람들의 현실 한가운데서 소망을 말해요.',
    passageSections: [
      { start: 35, end: 37, title: '고난은 사랑이 사라졌다는 증거가 아닙니다', explanation: '환난과 박해와 결핍을 실제로 겪는 사람들에게 바울은 고난 자체를 부정하지 않습니다. 그 현실도 그리스도의 사랑을 끊어 내지는 못한다고 선포합니다.' },
      { start: 38, end: 39, title: '어떤 권세도 하나님의 사랑에서 우리를 떼어 놓지 못합니다', explanation: '삶과 죽음, 현재와 미래, 눈에 보이는 힘과 보이지 않는 두려움까지 열거하며 하나님의 사랑이 더 크다고 고백합니다. 이것은 감정이 흔들리지 않는다는 말이 아니라 흔들리는 우리를 사랑이 붙든다는 말입니다.' },
    ],
  },
  '요한계시록-21-1-8': {
    title: '하나님이 눈물을 닦으시는 새 창조',
    summary: '성경의 마지막 소망은 세상을 버리고 도망가는 것이 아니라, 하나님이 만물을 새롭게 하시고 우리와 함께 사시는 것입니다.',
    context: '폭력적인 제국 아래서 버티던 교회가 들은 결말입니다. 악이 영원하지 않으며, 죽음과 눈물의 권세가 끝난다는 약속이에요.',
    passageSections: [
      { start: 1, end: 4, title: '하나님이 우리와 함께 사시는 새 창조가 옵니다', explanation: '성경의 마지막 소망은 현실을 버리고 도망가는 장면이 아니라 새 하늘과 새 땅, 하나님이 사람과 함께 거하시며 눈물을 닦으시는 회복입니다.' },
      { start: 5, end: 8, title: '만물을 새롭게 하시는 약속 앞에서 끝까지 믿음을 지킵니다', explanation: '보좌에 앉으신 분이 모든 것을 새롭게 하신다고 확증하십니다. 이 약속은 악을 가볍게 여기라는 말이 아니라 두려움과 거짓에 굴복하지 않고 진실하게 견디라는 부르심입니다.' },
    ],
  },
};

const DEFAULT_APPLICATIONS = [
  '단체 채팅방이나 짧은 영상에서 자극적인 정보를 보았을 때 바로 공유하지 말고, 사실인지와 누군가에게 해가 되지 않는지를 먼저 살펴봅니다.',
  '입시·취업·이직·집·투자·AI 활용을 결정할 때 속도와 이익만 보지 않고 정직, 공정, 이웃에게 미칠 영향도 함께 생각합니다.',
  '가정·직장·교회에서 누군가의 조언을 듣되, 부당한 요구까지 신앙의 이름으로 따르지 말고 필요한 경계를 세웁니다.',
];

function verseSpan(start: number, end: number) {
  return start === end ? `${start}절` : `${start}–${end}절`;
}

function readingUnitsFor(book: Book, chapter: number, start: number, end: number) {
  const overlapping = getPassageUnits(book.name, chapter)
    .filter((unit) => unit.end >= start && unit.start <= end)
    .map((unit) => ({ start: Math.max(start, unit.start), end: Math.min(end, unit.end) }));
  if (overlapping.length <= 6) return overlapping;

  const grouped: { start: number; end: number }[] = [];
  for (let index = 0; index < 6; index += 1) {
    const first = Math.floor((index * overlapping.length) / 6);
    const last = Math.floor(((index + 1) * overlapping.length) / 6) - 1;
    grouped.push({ start: overlapping[first].start, end: overlapping[last].end });
  }
  return grouped;
}

function fallbackPassageSections(book: Book, chapter: number, start: number, end: number): Sermon['passageSections'] {
  const guide = GROUP_GUIDE[book.group];
  const units = readingUnitsFor(book, chapter, start, end);
  return units.map((unit, index) => ({
    ...unit,
    title: units.length === 1
      ? '한 흐름으로 이어지는 말씀입니다'
      : `${index + 1}번째 문맥의 흐름을 따라갑니다`,
    explanation: index === 0
      ? `${verseSpan(unit.start, unit.end)}에서 본문이 처음 꺼내는 상황과 질문을 살펴봅니다. 한 문장만 떼기보다 누가 누구에게 왜 말하는지를 함께 읽어야 합니다.`
      : index === units.length - 1
        ? `${verseSpan(unit.start, unit.end)}에서 앞의 말씀이 어떤 응답과 삶으로 이어지는지 살펴봅니다. ${guide.lens}`
        : `${verseSpan(unit.start, unit.end)}에서 반복되는 말과 논리의 전환을 따라, 본문의 중심이 무엇을 강조하는지 천천히 살펴봅니다.`,
  }));
}

function fallbackManuscript(book: Book, chapter: number, start: number, end: number, sections: Sermon['passageSections']): Sermon['manuscript'] {
  const selectedReference = reference(book, chapter, start, end);
  const guide = GROUP_GUIDE[book.group];
  const closingPrayer = `하나님, ${selectedReference}의 말씀을 제 생각에 억지로 맞추지 않고 잘 듣게 해 주세요. 말씀 속에서 드러나는 주님의 마음을 알고, 오늘 제 관계와 선택 속에서 정직하게 살아내도록 지혜와 용기를 주세요. 혼자 힘으로 바꾸려 하기보다 은혜를 의지하게 하시고, 가장 가까운 이웃을 살리는 작은 순종을 시작하게 해 주세요. 예수님의 이름으로 기도합니다. 아멘.`;
  return {
    estimatedMinutes: Math.min(12, Math.max(8, 6 + sections.length)),
    introduction: [
      `사랑하는 여러분, 오늘 우리는 ${selectedReference}의 말씀 앞에 섭니다. 성경을 읽었는데도 뜻이 바로 들어오지 않을 때가 있습니다. 그것은 믿음이 없어서가 아니라, 오래전의 말씀이 오늘 우리의 삶에 어떻게 닿는지 천천히 설명을 들을 필요가 있기 때문입니다.`,
      `${book.name}은 ‘${book.theme}’이라는 큰 흐름을 품고 있습니다. 오늘은 한 구절만 떼어 답을 만들지 않고, 선택한 본문이 처음부터 끝까지 어디로 우리를 이끄는지 함께 따라가 보겠습니다.`,
      `이 말씀을 통해 무엇을 더 많이 아는 데서 멈추지 않고, 하나님을 어떻게 바라보고 이웃을 어떻게 대하며 오늘 어떤 한 걸음을 내디딜지 발견하기를 바랍니다.`,
    ],
    sections: sections.map((section, index) => ({
      start: section.start,
      end: section.end,
      heading: section.title,
      paragraphs: [
        section.explanation,
        `${verseSpan(section.start, section.end)}은 우리에게 서둘러 결론부터 내리지 말고 본문이 보여 주는 현실을 정직하게 보라고 요청합니다. 말씀 속 반복되는 표현과 사람들의 반응을 살피면, 하나님께서 무엇을 귀하게 여기시는지가 조금씩 선명해집니다.`,
        `우리도 비슷합니다. 불안하거나 마음이 급할수록 이미 정해 둔 답을 성경에서 확인하려고 하기 쉽습니다. 그러나 말씀은 내 편을 들어 주는 도구가 아니라 내 시선을 새롭게 하는 빛입니다. ${guide.lens}`,
        `그러므로 이 대목을 읽으며 다른 사람을 먼저 판단하기보다 내 안의 두려움과 욕심을 하나님 앞에 솔직하게 내려놓아야 합니다. 하나님은 우리를 몰아붙이기보다 은혜 안에서 진실을 보게 하시고, 그 진실을 오늘의 작은 순종으로 옮기도록 부르십니다.`,
      ],
      bridgeToNext: index < sections.length - 1
        ? `이제 말씀은 여기에서 멈추지 않고 ${verseSpan(sections[index + 1].start, sections[index + 1].end)}의 다음 흐름으로 우리를 이끕니다.`
        : '이제 본문의 전체 흐름을 마음에 품고 오늘의 삶으로 돌아가 보겠습니다.',
    })),
    gospelConnection: [
      '성경의 말씀은 우리가 스스로 완벽해져 하나님께 올라가는 방법을 가르치는 성공 공식이 아닙니다. 하나님께서 먼저 우리에게 다가오시고, 넘어지는 사람을 다시 일으키시는 은혜가 언제나 순종보다 앞섭니다.',
      '예수님은 말씀을 많이 아는 사람만을 부르지 않으셨습니다. 듣고도 자주 실패하는 제자들을 끝까지 사랑하시고, 십자가와 부활로 새로운 길을 여셨습니다. 그래서 우리는 정죄에 눌려서가 아니라 이미 받은 사랑에 응답하며 오늘 한 걸음을 시작할 수 있습니다.',
    ],
    conclusion: [
      `${selectedReference}이 오늘 우리에게 주는 초대는 거창한 결심이 아닙니다. 말씀 앞에서 내 생각을 잠시 멈추고, 하나님과 이웃을 살리는 방향으로 오늘의 선택 하나를 바꾸는 일입니다.`,
      `이번 주에 가장 자주 마주치는 한 사람과 한 가지 결정을 떠올려 보세요. 말하기 전에 한 번 더 듣고, 내 이익만 아니라 정직과 사랑을 함께 선택해 보십시오. 작은 순종의 자리에서 말씀이 지식이 아니라 삶이 되는 은혜를 경험하기를 바랍니다.`,
    ],
    closingPrayer,
  };
}

function makeSermon(book: Book, chapter: number, start: number, end: number, careTopic?: CareTopic): Sermon {
  const guide = GROUP_GUIDE[book.group];
  const selectedReference = reference(book, chapter, start, end);
  const curated = CURATED[`${book.name}-${chapter}-${start}-${end}`];
  const passageSections = fallbackPassageSections(book, chapter, start, end);
  const base: Sermon = {
    title: `${selectedReference}을 오늘의 삶으로 읽는 법`,
    summary: `${book.name}의 중심 주제인 ‘${book.theme}’을 기억하며, 선택한 말씀 단락이 하나님과 이웃을 대하는 우리의 방향을 어떻게 다듬는지 살펴봅니다.`,
    opening: `하루를 살다 보면 “이럴 때 믿는 사람은 어떻게 해야 할까?” 싶은 순간을 만납니다. ${selectedReference}은 오래전 사람들에게 주어진 말씀이지만, ‘${book.theme}’이라는 큰 흐름을 통해 오늘 우리의 관계와 선택도 비춰 줍니다.`,
    context: guide.context,
    passageSections,
    points: [
      { title: '먼저 선택한 단락의 흐름을 읽어요', body: `${book.name}은 ‘${book.theme}’을 중심으로 흐릅니다. ${verseSpan(start, end)} 안에서 반복되는 말과 장면을 먼저 찾고, 앞뒤 단락과 책 전체의 흐름까지 연결하면 뜻이 더 또렷해져요.` },
      { title: '하나님은 어떤 분으로 나타나시나요?', body: '본문 속 명령이나 인물보다 먼저, 하나님이 무엇을 소중히 여기고 누구에게 다가가시는지 찾아보세요. 이것이 적용의 방향을 바로 잡아 줍니다.' },
      { title: '오늘 바꿀 한 가지를 고릅니다', body: guide.lens },
    ],
    illustration: `창문이 흐리면 바깥 풍경이 흐린 것이 아니라 내가 보는 유리가 흐린 것일 수 있어요. 말씀 묵상은 현실을 외면하는 일이 아니라, 욕심과 두려움으로 흐려진 시선을 닦아 하나님과 이웃을 다시 보는 일입니다. ${selectedReference}을 읽으며 “본문이 틀렸다”보다 “내 시선에서 닦여야 할 것은 무엇인가”를 먼저 물어보세요.`,
    crossReferences: [
      { reference: '누가복음 24장 27절', connection: '성경의 각 부분을 예수 그리스도 안에서 이어 읽는 큰 방향을 보여 줍니다.' },
      { reference: '야고보서 1장 22절', connection: '말씀을 듣는 데서 멈추지 않고 삶으로 행하라고 초대합니다.' },
    ],
    applications: [guide.action, ...DEFAULT_APPLICATIONS.slice(0, 2)],
    caution: guide.caution,
    questions: [
      `이 본문에서 하나님은 어떤 분으로 보이나요?`,
      `나를 위로하거나 불편하게 하는 대목은 무엇이며, 왜 그런가요?`,
      `오늘 말이나 행동 하나를 바꾼다면 무엇을 선택하겠어요?`,
    ],
    decision: `오늘 ${selectedReference}의 가르침을 떠올리며, 가장 가까운 한 사람에게 진실하고 선한 행동 하나를 먼저 실천하겠습니다.`,
    prayer: `하나님, ${book.name}의 말씀을 제 생각에 억지로 맞추지 않고 잘 듣게 해 주세요. ‘${book.theme}’의 뜻을 오늘 제 관계와 선택 속에서 정직하게 살아내도록 지혜와 용기를 주세요. 아멘.`,
    manuscript: fallbackManuscript(book, chapter, start, end, passageSections),
  };

  const selected = { ...base, ...curated, points: curated?.points ?? base.points };
  if (!careTopic) return selected;
  const carePassage = CARE_PASSAGE_DETAILS[careTopic.id];

  return {
    ...selected,
    title: `${careTopic.label} 속에서 붙드는 말씀`,
    summary: `입력에서 찾은 ${careTopic.label} 주제와 함께 ${selectedReference}을 읽습니다. ${careTopic.reason}`,
    opening: `${careTopic.care} 그래서 지금은 성급한 정답보다, 이 마음을 숨기지 않은 채 말씀 곁에 머무는 것부터 시작해도 괜찮아요. ${selectedReference}은 오늘의 상황을 단숨에 해결하는 공식이 아니라, 혼자 견디지 않도록 시선을 다시 세워 주는 말씀입니다.`,
    context: carePassage?.context ?? selected.context,
    points: [
      { title: '이 말씀은 지금의 마음을 외면하지 않아요', body: careTopic.reason },
      { title: '믿음의 말로 아픔을 덮지 않아요', body: careTopic.care },
      { title: '오늘 할 수 있는 작은 한 걸음', body: careTopic.firstStep },
    ],
    applications: [careTopic.firstStep, ...selected.applications.slice(0, 2)],
    crossReferences: carePassage?.related ?? selected.crossReferences,
    questions: [
      `지금 ${careTopic.label} 때문에 가장 무거운 순간은 언제인가요?`,
      '혼자 감당하지 않도록 오늘 도움을 요청할 수 있는 사람은 누구인가요?',
      '이 말씀을 읽고 오늘 한 가지 내려놓거나 시작한다면 무엇인가요?',
    ],
    decision: careTopic.firstStep,
    prayer: '하나님, 지금 제 마음을 숨기지 않고 가져갑니다. 필요한 지혜와 위로를 주시고, 혼자 버티지 않게 도와주세요. 말씀을 따라 오늘 할 수 있는 작은 한 걸음을 내딛게 해 주세요. 아멘.',
    caution: `${selected.caution} 이 추천은 하나님의 개인적인 지시를 확정하거나 의료·상담·법률 지원을 대신하지 않습니다.`,
  };
}

function reference(book: Book, chapter: number, start: number, end: number) {
  return `${book.name} ${chapter}장 ${start}${end > start ? `–${end}` : ''}절`;
}

function answerQuestion(question: string, sermon: Sermon, ref: string) {
  const compact = question.replace(/\s/g, '');
  if (compact.includes('경외') || compact.includes('무서워')) {
    return `성경에서 “경외”는 공포에 눌려 숨는 것과 달라요. 하나님을 가장 중요하고 선하신 분으로 인정해, 내 욕심보다 그분의 뜻을 기준으로 삼는 신뢰와 존중에 가깝습니다. ${ref}도 사람의 폭력이나 통제를 참고 복종하라는 뜻으로 읽으면 안 됩니다.`;
  }
  if (compact.includes('적용') || compact.includes('어떻게') || compact.includes('실천')) {
    return `아주 작게 시작해 보세요. ${sermon.applications[0]} 오늘 저녁에 “내가 실제로 한 것은 무엇인가?”를 한 문장으로 적으면 묵상이 행동으로 이어지는 데 도움이 됩니다.`;
  }
  if (compact.includes('기도')) return sermon.prayer;
  if (compact.includes('고난') || compact.includes('불안') || compact.includes('우울')) {
    return `이 본문을 고통받는 사람을 탓하는 말로 사용하지 않는 것이 중요해요. 믿음이 있어도 불안과 슬픔을 겪을 수 있습니다. 말씀과 기도를 붙들되, 일상이 무너질 만큼 힘들다면 믿을 만한 사람과 정신건강 전문가의 도움을 함께 받으세요. 위급하면 112·119나 가까운 응급실에 바로 도움을 요청하세요.`;
  }
  if (compact.includes('왜') || compact.includes('맥락')) return `${sermon.context} 그래서 ${ref}은 앞뒤 문맥과 책 전체의 흐름을 함께 볼 때 오해를 줄일 수 있어요.`;
  return `${ref}의 핵심을 한 문장으로 말하면 “${sermon.summary}”입니다. 질문하신 부분을 이해할 때는 먼저 본문에서 반복되는 말과 앞뒤 단락을 확인해 보세요. 특정 구절이나 표현을 조금 더 적어 주시면 그 지점에 맞춰 더 쉽게 풀어드릴게요.`;
}

const QUICK_READINGS = [
  { label: '오늘', book: '잠언', chapter: 1, start: 1, end: 33 },
  { label: '위로', book: '시편', chapter: 23, start: 1, end: 6 },
  { label: '염려', book: '마태복음', chapter: 6, start: 25, end: 34 },
];

const CARE_TOPICS: CareTopic[] = [
  {
    id: 'anxiety', label: '불안과 걱정', keywords: ['불안', '걱정', '초조', '공황', '앞날', '미래가', '잠이 안', '불면'],
    book: '마태복음', chapter: 6, start: 25, end: 34,
    reason: '예수님은 불안을 믿음 부족으로 낙인찍지 않고, 하나님의 돌보심과 오늘 감당할 몫으로 시선을 돌리게 하십니다.',
    care: '불안은 마음먹는다고 바로 꺼지는 스위치가 아니며, 믿음이 있어도 몸과 마음이 흔들릴 수 있어요.',
    firstStep: '오늘 해결할 수 있는 일 하나와 오늘은 맡겨 둘 일 하나를 나누어 적고, 감당하기 어렵다면 상담이나 진료의 도움도 함께 요청해 보세요.',
  },
  {
    id: 'discouragement', label: '낙심과 무기력', keywords: ['우울', '낙심', '무기력', '절망', '의욕이 없', '아무것도 하기 싫', '눈물'],
    book: '시편', chapter: 42, start: 1, end: 11,
    reason: '시인은 깊은 낙심을 숨기지 않으면서 하나님께 질문하고, 서두르지 않은 채 다시 소망을 바라봅니다.',
    care: '기운이 나지 않는 날을 신앙의 실패라고 몰아붙이지 않아도 됩니다. 오래 이어지거나 일상이 무너지면 전문적인 도움도 꼭 필요해요.',
    firstStep: '오늘 해야 할 일을 가장 작은 한 단계로 줄이고, 믿을 만한 사람 한 명에게 “요즘 많이 지쳐 있다”고 알려 보세요.',
  },
  {
    id: 'loneliness', label: '외로움과 고립', keywords: ['외롭', '혼자', '고립', '버려진', '아무도 없', '친구가 없'],
    book: '디모데후서', chapter: 4, start: 16, end: 18,
    reason: '바울은 모두가 곁을 떠난 아픔을 솔직히 말하면서도 주께서 곁에 서셨음을 붙듭니다. 사람에게 버림받은 경험을 믿음 없는 것으로 숨기지 않습니다.',
    care: '하나님이 함께하신다는 말은 사람의 돌봄이 필요 없다는 뜻이 아니에요. 외로움을 혼자 견디는 훈련으로 만들지 마세요.',
    firstStep: '연락하기 덜 부담스러운 사람 한 명에게 안부를 보내고, 교회나 지역 모임처럼 반복해서 만날 수 있는 안전한 연결 하나를 찾아보세요.',
  },
  {
    id: 'relationship', label: '관계의 갈등', keywords: ['싸움', '갈등', '다툼', '배신', '소통', '관계', '부부', '연인', '친구 사이'],
    book: '로마서', chapter: 12, start: 14, end: 21,
    reason: '이 말씀은 보복을 멈추고 가능한 만큼 평화를 구하되, 상대방의 선택까지 내 책임으로 떠안기지는 않게 합니다.',
    care: '평화를 구한다는 것은 모욕과 폭력을 계속 참거나, 안전하지 않은 관계로 돌아가라는 뜻이 아닙니다.',
    firstStep: '감정이 격할 때는 대화를 잠시 멈추고, 내가 바꿀 수 있는 말 한 문장과 지켜야 할 경계 한 가지를 적어 보세요.',
  },
  {
    id: 'forgiveness', label: '용서와 원망', keywords: ['용서', '원망', '앙금', '화해', '미워', '상처 준 사람'],
    book: '마태복음', chapter: 18, start: 21, end: 35,
    reason: '예수님은 받은 자비가 관계를 바꾸어야 한다고 말씀하시며, 복수심에 붙들린 마음을 놓도록 초대하십니다.',
    care: '용서는 잘못을 없던 일로 만들거나 즉시 다시 신뢰하고 위험한 관계로 돌아가라는 명령이 아닙니다.',
    firstStep: '당장 화해를 결정하기보다, 받은 상처와 필요한 경계를 정직하게 적고 안전한 목회자나 상담자와 다음 단계를 의논해 보세요.',
  },
  {
    id: 'work', label: '직장과 일의 무게', keywords: ['직장', '취업', '면접', '실직', '업무', '상사', '퇴사', '회사'],
    book: '시편', chapter: 90, start: 1, end: 17,
    reason: '유한하고 불안정한 삶을 인정하면서도, 우리 손의 수고가 헛되지 않도록 하나님께 의미와 지혜를 구하는 기도입니다.',
    care: '성과와 직함이 사람의 가치를 결정하지 않습니다. 부당한 노동환경을 참고 버티는 것이 곧 충성은 아니에요.',
    firstStep: '오늘 통제할 수 있는 업무 한 가지에 집중하고, 과로나 부당함이 이어진다면 기록을 남겨 믿을 만한 동료나 전문기관과 상의해 보세요.',
  },
  {
    id: 'finances', label: '경제적인 어려움', keywords: ['돈', '빚', '생활비', '월세', '카드값', '경제', '가난', '대출'],
    book: '신명기', chapter: 15, start: 7, end: 11,
    reason: '경제적 곤란을 개인의 믿음 부족으로 돌리지 않고, 공동체가 손을 열어 실제로 도와야 할 책임을 강조합니다.',
    care: '재정 위기는 부끄러움으로 숨길 일이 아니며, 말씀은 무리한 헌금이나 투자로 상황을 뒤집으라고 강요하지 않습니다.',
    firstStep: '이번 주 필수 지출과 미룰 지출을 나누고, 교회 구제·복지 상담·채무 조정처럼 실제 도움을 받을 수 있는 한 곳에 연락해 보세요.',
  },
  {
    id: 'direction', label: '진로와 결정', keywords: ['진로', '선택', '결정', '이직', '전공', '길을 모르', '앞길'],
    book: '로마서', chapter: 12, start: 1, end: 8,
    reason: '하나님의 뜻을 신비한 신호 하나로 찾기보다 생각의 변화, 겸손, 은사와 공동체 안에서 분별하도록 돕습니다.',
    care: '한 번의 선택으로 인생 전체가 망한다는 두려움에 눌리지 않아도 됩니다. 신앙은 정답 맞히기보다 지혜롭게 걸어가는 관계예요.',
    firstStep: '선택지마다 얻는 것·잃는 것·도움이 필요한 것을 적고, 내 상황을 잘 아는 두 사람의 의견을 들어 본 뒤 결정 시한을 정해 보세요.',
  },
  {
    id: 'guilt', label: '죄책감과 후회', keywords: ['죄책감', '후회', '잘못했', '회개', '죄를 지었', '양심', '가책'],
    book: '누가복음', chapter: 15, start: 11, end: 32,
    reason: '잘못을 인정하고 돌아오는 사람을 맞아 주시는 은혜와, 자기 의에 갇힌 마음까지 함께 비추어 줍니다.',
    care: '은혜는 책임을 피하는 핑계가 아니지만, 잘못 하나가 내 존재 전체를 무가치하게 만들지도 않습니다.',
    firstStep: '구체적으로 무엇을 잘못했는지 인정하고, 안전하고 가능한 범위에서 사과·배상·재발 방지 중 오늘 시작할 한 가지를 정해 보세요.',
  },
  {
    id: 'grief', label: '상실과 애도', keywords: ['상실', '사별', '장례', '애도', '떠나보냄', '돌아가셨', '세상을 떠', '잃었'],
    book: '요한복음', chapter: 11, start: 17, end: 37,
    reason: '예수님은 슬픔 앞에서 설명부터 하지 않고 함께 우십니다. 그래서 애도를 서둘러 끝내도록 압박하지 않습니다.',
    care: '슬픔에는 정해진 시간표가 없어요. 울음과 그리움이 되돌아오는 것은 믿음이 약해서가 아닙니다.',
    firstStep: '잃은 사람이나 것에 대해 기억하고 싶은 한 장면을 적고, 오늘 혼자 있기 어렵다면 곁에 있어 달라고 구체적으로 부탁해 보세요.',
  },
  {
    id: 'pain', label: '질병과 고통', keywords: ['질병', '수술', '통증', '장애', '치료', '건강', '아프', '병원', '암'],
    book: '로마서', chapter: 8, start: 18, end: 27,
    reason: '고통을 금방 사라질 문제로 축소하지 않고, 탄식 속에서 성령이 말로 다 못 하는 기도를 도우신다고 전합니다.',
    care: '아픈 이유를 개인의 죄나 믿음 부족으로 단정해서는 안 됩니다. 기도와 치료는 서로 경쟁하지 않아요.',
    firstStep: '증상과 궁금한 점을 적어 의료진에게 알리고, 식사·이동·동행처럼 지금 필요한 실제 도움 하나를 주변에 요청해 보세요.',
  },
  {
    id: 'anger', label: '분노와 억울함', keywords: ['화가 나', '화나', '분노', '억울', '복수', '폭발', '짜증'],
    book: '에베소서', chapter: 4, start: 17, end: 32,
    reason: '분노를 모른 척하지 않으면서, 해로운 말과 행동을 멈추고 진실·정의·긍휼로 바꾸는 구체적인 길을 보여 줍니다.',
    care: '분노는 잘못과 침해를 알려 주는 신호일 수 있지만, 나나 다른 사람을 해치는 행동을 정당화하지는 않습니다.',
    firstStep: '몸이 진정될 때까지 자리를 벗어나 천천히 숨을 쉬고, 사실·감정·요청을 나누어 한 문장씩 적은 뒤 안전할 때 말해 보세요.',
  },
  {
    id: 'burnout', label: '지침과 번아웃', keywords: ['번아웃', '지침', '소진', '과로', '쉬고 싶', '지쳤', '피곤'],
    book: '마태복음', chapter: 11, start: 25, end: 30,
    reason: '예수님의 온유한 멍에는 성과 경쟁의 무거운 짐과 다르며, 지친 사람이 그분에게서 쉼을 배우게 합니다.',
    care: '쉬어야 한다는 신호를 게으름으로 몰아붙이지 마세요. 회복에는 기도뿐 아니라 수면, 경계, 실제적인 지원도 필요합니다.',
    firstStep: '오늘 꼭 하지 않아도 되는 일 하나를 내려놓고, 휴식 시간을 일정에 먼저 적은 뒤 주변 사람에게 현재의 한계를 알려 보세요.',
  },
];

const CARE_PASSAGE_DETAILS: Record<string, { context: string; related: Sermon['crossReferences'] }> = {
  anxiety: {
    context: '마태복음 6장 25–34절은 산상설교의 한가운데에 있습니다. 예수님은 보물과 주인을 어디에 둘지 말씀하신 뒤, 먹을 것과 입을 것을 염려하던 사람들에게 새와 들꽃을 보라고 하십니다. 현실의 필요를 부정하기보다 하나님 나라와 의를 먼저 구하고, 내일의 짐을 오늘까지 끌어오지 말라고 초대하십니다.',
    related: [
      { reference: '빌립보서 4장 6–7절', connection: '염려를 숨기지 않고 구체적인 기도와 감사로 하나님께 가져가도록 초대합니다.' },
      { reference: '베드로전서 5장 7절', connection: '하나님이 돌보시는 분이기에 염려를 그분께 맡길 수 있다고 말합니다.' },
    ],
  },
  discouragement: {
    context: '시편 42편은 하나님을 갈망하면서도 눈물과 조롱, 예배 공동체를 잃은 기억 때문에 낙심한 사람의 노래입니다. 시인은 같은 후렴을 되풀이하며 자기 영혼에게 소망을 말하지만, 슬픔을 억지로 끝내지는 않습니다. 탄식과 소망이 한 기도 안에 함께 머뭅니다.',
    related: [
      { reference: '예레미야애가 3장 21–24절', connection: '깊은 슬픔 속에서도 하나님의 인자와 긍휼을 다시 기억합니다.' },
      { reference: '고린도후서 4장 8–9절', connection: '눌리고 낙심하는 현실을 인정하면서도 완전히 버림받지는 않았다고 고백합니다.' },
    ],
  },
  loneliness: {
    context: '디모데후서 4장 16–18절은 바울이 첫 변론 때 아무도 자신을 돕지 않고 모두 떠났던 일을 회상하는 대목입니다. 그는 버림받은 상처를 감추지 않으면서도 주께서 곁에 서서 힘을 주셨다고 고백합니다. 하나님의 동행은 사람의 부재를 아무렇지 않게 만드는 말이 아니라, 외로운 자리에서 무너지지 않게 붙드는 소망입니다.',
    related: [
      { reference: '시편 27편 10절', connection: '가장 가까운 사람에게 외면받는 때에도 하나님이 받아 주신다는 소망을 전합니다.' },
      { reference: '히브리서 13장 5절', connection: '하나님이 결코 버리거나 떠나지 않으신다는 약속을 상기시킵니다.' },
    ],
  },
  relationship: {
    context: '로마서 12장 14–21절은 복음의 은혜로 새로워진 공동체가 갈등과 박해를 어떻게 다룰지 설명합니다. 함께 기뻐하고 울며, 스스로 보복하지 않고 가능한 만큼 평화를 이루라고 합니다. “악을 선으로 이기라”는 말은 피해를 참으라는 명령이 아니라, 악의 방식을 닮지 않으면서 안전과 정의를 함께 구하라는 초대입니다.',
    related: [
      { reference: '마태복음 5장 44절', connection: '원수를 사랑하고 박해하는 이를 위해 기도하라는 예수님의 가르침과 이어집니다.' },
      { reference: '야고보서 1장 19–20절', connection: '듣기는 빠르게, 말하고 성내기는 더디 하라는 관계의 지혜를 줍니다.' },
    ],
  },
  forgiveness: {
    context: '마태복음 18장 21–35절은 공동체 안의 잘못과 회복을 다룬 가르침 뒤에 나옵니다. 베드로의 횟수 질문에 예수님은 큰 빚을 탕감받고도 작은 빚을 붙든 종의 비유로 답하십니다. 받은 자비가 관계를 바꾸어야 하지만, 이 비유가 학대의 책임이나 안전한 경계를 없애지는 않습니다.',
    related: [
      { reference: '에베소서 4장 31–32절', connection: '악독을 버리고 그리스도 안에서 받은 용서를 따라 서로 친절히 대하라고 합니다.' },
      { reference: '로마서 12장 19절', connection: '복수는 내려놓되 정의를 부정하지 않고 심판을 하나님께 맡기라고 권합니다.' },
    ],
  },
  work: {
    context: '시편 90편은 영원하신 하나님과 짧고 수고로운 인간의 시간을 나란히 놓는 기도입니다. 삶의 유한함을 외면하지 않고, 날을 헤아리는 지혜와 하나님의 긍휼을 구한 뒤 마지막에 “우리 손의 행사를 견고하게 하소서”라고 기도합니다. 성과가 사람을 영원하게 하지는 못하지만 우리의 수고를 하나님께 맡길 수 있습니다.',
    related: [
      { reference: '전도서 3장 12–13절', connection: '일하며 누리는 작은 기쁨도 하나님이 주신 선물로 받아들이게 합니다.' },
      { reference: '골로새서 3장 23–24절', connection: '사람의 평가만이 아니라 주를 섬기는 마음으로 성실히 일하라고 권합니다.' },
    ],
  },
  finances: {
    context: '신명기 15장 7–11절은 빚을 면제하고 가난한 이웃에게 손을 열라는 안식년 규정 안에 있습니다. 손해가 두려워 마음과 손을 닫지 말고 필요한 만큼 넉넉히 빌려 주라고 합니다. 가난을 개인 탓으로 돌리지 않고 공동체가 책임 있게 나누어야 한다는 말씀입니다.',
    related: [
      { reference: '고린도후서 8장 13–15절', connection: '한쪽만 무겁게 짐 지우는 것이 아니라 서로의 부족을 채우는 균형을 말합니다.' },
      { reference: '야고보서 2장 15–16절', connection: '필요한 사람에게 말뿐인 평안이 아니라 실제 도움을 주어야 한다고 일깨웁니다.' },
    ],
  },
  direction: {
    context: '로마서 12장 1–8절은 앞선 열한 장에서 설명한 하나님의 자비에 대한 응답으로 시작합니다. 몸을 산 제물로 드리고 생각을 새롭게 하여 하나님의 뜻을 분별하며, 자신을 과대평가하지 않고 공동체 안의 다양한 은사를 사용하라고 합니다. 진로 분별은 비밀 신호 하나보다 새로워진 생각, 겸손, 공동체의 지혜와 연결됩니다.',
    related: [
      { reference: '야고보서 1장 5절', connection: '지혜가 부족할 때 꾸짖지 않고 주시는 하나님께 구하라고 초대합니다.' },
      { reference: '잠언 3장 5–6절', connection: '자기 판단만 의지하지 않고 삶의 길에서 하나님을 인정하라고 권합니다.' },
    ],
  },
  guilt: {
    context: '누가복음 15장 11–32절은 잃은 양과 잃은 동전 이야기 뒤에 이어지는 두 아들과 아버지의 비유입니다. 집을 떠난 아들은 잘못을 인정하고 돌아오며, 아버지는 달려가 맞아 줍니다. 집에 남았지만 은혜를 받아들이지 못한 큰아들의 분노도 함께 드러나므로, 회개와 환대뿐 아니라 자기 의도 비추는 말씀입니다.',
    related: [
      { reference: '로마서 8장 1절', connection: '그리스도 예수 안에 있는 사람에게 정죄가 없다는 복음의 토대를 줍니다.' },
      { reference: '시편 51편 10–12절', connection: '잘못을 숨기지 않고 깨끗한 마음과 새 영을 구하는 회개의 기도입니다.' },
    ],
  },
  grief: {
    context: '요한복음 11장 17–37절에서 나사로는 이미 죽어 무덤에 있은 지 나흘이 되었습니다. 마르다와 마리아는 예수님께 슬픔과 아쉬움을 솔직히 말하고, 예수님은 부활의 소망을 선포하시면서도 함께 우십니다. 믿음과 눈물은 서로 반대가 아니며, 소망은 애도를 서둘러 끝내지 않습니다.',
    related: [
      { reference: '시편 34편 18절', connection: '마음이 상한 사람에게 하나님이 가까이 계신다고 전합니다.' },
      { reference: '데살로니가전서 4장 13–14절', connection: '슬퍼하지 말라는 말이 아니라 부활의 소망을 품고 슬퍼하도록 돕습니다.' },
    ],
  },
  pain: {
    context: '로마서 8장 18–27절은 현재의 고난과 장차 올 영광을 함께 바라봅니다. 피조세계도, 믿는 사람도 탄식하며 몸의 구원을 기다리고, 말로 기도할 수 없을 때 성령께서 탄식으로 도우십니다. 이 소망은 통증을 작게 여기지 않고 고통 한가운데 혼자가 아님을 전합니다.',
    related: [
      { reference: '고린도후서 12장 9절', connection: '약함이 사라지지 않는 때에도 그리스도의 은혜가 충분하다는 약속을 전합니다.' },
      { reference: '요한계시록 21장 4절', connection: '죽음과 아픔과 눈물이 끝나는 새 창조의 소망을 보여 줍니다.' },
    ],
  },
  anger: {
    context: '에베소서 4장 17–32절은 옛 사람을 벗고 새 사람을 입는 삶을 구체적인 말과 행동으로 설명합니다. 분노 자체를 부정하지 않지만 분노가 죄와 파괴적인 말로 자라지 않게 하며, 거짓 대신 진실을 말하고 해로운 말 대신 사람을 세우는 말을 하라고 권합니다.',
    related: [
      { reference: '야고보서 1장 19–20절', connection: '사람의 성냄이 하나님의 의를 이루지 못하므로 말과 반응의 속도를 늦추라고 합니다.' },
      { reference: '시편 4편 4절', connection: '분노할 때 죄를 짓지 말고 잠잠히 마음을 살피라고 권합니다.' },
    ],
  },
  burnout: {
    context: '마태복음 11장 25–30절에서 예수님은 지혜롭다고 여기는 이들에게 감추어진 하나님 나라가 작은 이들에게 드러났다고 기뻐하신 뒤, 수고하고 무거운 짐 진 이들을 부르십니다. 예수님의 멍에는 무책임한 도피가 아니라 온유하고 겸손한 스승에게 배우며 다른 방식으로 짐을 지는 제자도의 쉼입니다.',
    related: [
      { reference: '마가복음 6장 31절', connection: '사역으로 지친 제자들에게 한적한 곳에서 잠시 쉬라고 하신 예수님의 돌봄을 보여 줍니다.' },
      { reference: '히브리서 4장 9–11절', connection: '하나님의 백성에게 남아 있는 안식에 들어가도록 초대합니다.' },
    ],
  },
  'general-care': {
    context: '시편 62편은 흔들리는 현실과 적대적인 사람들 앞에서 하나님만이 구원과 피난처라고 되풀이해 고백하는 노래입니다. 시인은 힘든 마음을 감추라고 하지 않고, 백성에게 마음을 하나님 앞에 쏟아 놓으라고 권합니다. 사람의 지위와 재물은 가벼운 입김 같지만, 사랑과 능력은 하나님께 속해 있다고 붙듭니다.',
    related: [
      { reference: '시편 55편 22절', connection: '감당하기 어려운 짐을 하나님께 맡기며 붙드심을 구하도록 초대합니다.' },
      { reference: '베드로전서 5장 7절', connection: '하나님이 돌보시는 분이기에 염려를 그분께 맡길 수 있다고 말합니다.' },
    ],
  },
};

const SELF_HARM_TOPIC: CareTopic = {
  id: 'life-safety', label: '생명과 안전', keywords: [], book: '시편', chapter: 34, start: 1, end: 22,
  reason: '시인은 두려움과 깨어진 마음을 숨기지 않고 도움을 구합니다. 그러나 지금은 말씀 추천보다 즉시 사람과 연결되어 안전을 확보하는 일이 먼저입니다.',
  care: '이 정도의 고통을 혼자 견뎌야 할 이유는 없습니다. 믿음의 문제로만 다루지 말고 지금 곁에 있어 줄 사람과 긴급 도움에 연결되어야 해요.',
  firstStep: '이미 다쳤거나 실행 직전이면 119·112 또는 가까운 응급실에 먼저 연락하세요. 혼자 있지 말고 위험한 물건이나 장소에서 떨어진 뒤 24시간 자살예방 상담전화 109에도 도움을 요청하세요.',
};

const VIOLENCE_TOPIC: CareTopic = {
  id: 'violence-safety', label: '폭력에서의 안전', keywords: [], book: '시편', chapter: 34, start: 1, end: 22,
  reason: '하나님은 폭력을 견디라고 강요하지 않으시며, 상한 마음과 위험에 놓인 사람의 부르짖음을 외면하지 않으십니다.',
  care: '폭력·성폭력·스토킹·감금·협박은 단순한 관계 갈등이나 용서의 문제로 축소해서는 안 됩니다. 피해자의 안전이 먼저예요.',
  firstStep: '가해자와 혼자 대면하지 말고 가능한 안전한 곳으로 이동해 112 또는 여성긴급전화 1366에 도움을 요청하세요.',
};

const GENERAL_CARE_TOPIC: CareTopic = {
  id: 'general-care', label: '무거운 마음', keywords: [], book: '시편', chapter: 62, start: 1, end: 12,
  reason: '시인은 흔들리는 현실을 숨기지 않으면서, 마음을 하나님 앞에 쏟아 놓고 안전한 피난처를 찾습니다.',
  care: '지금의 마음을 한 단어로 정확히 설명하지 못해도 괜찮아요. 성급히 원인을 단정하지 않고 천천히 이야기를 더 들어야 합니다.',
  firstStep: '지금 가장 무거운 일을 한 문장으로 적고, 오늘 곁에서 이야기를 들어 줄 사람 한 명에게 도움을 요청해 보세요.',
};

function normalizedConcern(value: string) {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function detectUrgency(value: string, source: 'concern' | 'question' = 'concern'): CareResult['urgent'] {
  const compact = normalizedConcern(value);
  if (!compact) return null;

  const academicQuestion = /(성경|본문|설교|장면|인물|신학적|교회의역할|교회는|예방|시도자|돕는법|도움을주는법|어떤말씀을전|말씀을전하|피해자(를)?지원|피해자(는|가).{0,10}(신고|지원|보호|도와)|지원해야|에관한질문|관련된질문|관련질문|사례|뉴스|영화|드라마|무슨뜻|어떤의미|유다는|유다가|궁금해)/.test(compact);
  const personalSelfDisclosure = /(제가|저는|나는|내가|저도|나도).{0,20}(죽고싶|죽는편이|없어지는게|살기싫|살고싶지않|삶을포기|인생을포기|자살(을|를)?(하려|할|생각|충동|계획|시도(를|을)?했|시도하려)|자해(를|을)?(했|시도(를|을)?했|시도하려|하려|할|생각|충동|하고싶)|극단적선택(을|를)?시도(를|을)?했)/.test(compact);
  const personalVictimDisclosure = [
    /(제가|저는|나는|내가).{0,18}(맞고|맞았|(폭행|성폭력|성폭행|성추행|감금|스토킹)(을|를)?당|(폭행|성폭력|성폭행|성추행|스토킹).{0,8}피해.{0,5}입|협박(을|를)?받)/,
    /(나를|저를|나한테|저한테|내게|저에게|제게).{0,16}(때리|때릴|때렸|때려|죽이려|죽일|해치려|해칠|찌르려|찌를|폭행|손찌검|발로차|밀쳤|목을조|목졸|협박|감금)/,
  ].some((pattern) => pattern.test(compact));
  const personalHarmDisclosure = /(제가|저는|나는|내가|저도|나도).{0,32}(죽이고싶|죽이려고|죽이겠|죽일계획|죽일까봐|해치고싶|해칠것같|해칠까봐|찌르고싶|찌를까봐|때리고싶|때릴것같|때릴까봐)/.test(compact);
  const personalDisclosure = personalSelfDisclosure || personalVictimDisclosure || personalHarmDisclosure;
  const quotedAcademicQuestion = [
    /(성경|본문|설교).{0,22}(죽고싶|자살|자해|죽이|해치|찌르|때리).{0,16}(표현|인물|문장|구절|뜻|의미|궁금)/,
    /(죽고싶|자살|자해|죽이|해치|찌르|때리).{0,14}(표현|인물|문장|구절).{0,14}(궁금|신학적|묻)/,
  ].some((pattern) => pattern.test(compact));
  const personalCrisis = personalDisclosure && !quotedAcademicQuestion;
  const reportedOtherThreat = /(남편|아내|배우자|애인|연인|남자친구|여자친구|부모|아빠|엄마|친구|상사|가해자|상대|그사람|누군가)(이|가|은|는).{0,14}(나를|저를|나한테|저한테|아내를|남편을|엄마를|아빠를|아이를|딸을|아들을|사람을|누군가를).{0,14}(죽이고싶대|죽이고싶다고|죽이려고|죽이겠대|죽이겠다고|죽인다고|죽일것같|해치고싶대|해치고싶다고|해치려고|해치겠대|해치겠다고|해친다고|해칠것같|찌르고싶대|찌르고싶다고|찌르려고|찌르겠대|찌르겠다고|찌른다고|찌를것같|때리고싶대|때리고싶다고|때리려고|때리겠대|때리겠다고|때린다고|때릴것같)/.test(compact);
  const directVictimThreat = /(나를|저를|나한테|저한테|내게|저에게|제게).{0,14}(죽이려고|죽이고싶대|죽이고싶다고|죽이겠다고|죽인다고|죽일것같|해치려고|해치고싶대|해치고싶다고|해치겠다고|해친다고|해칠것같|찌르려고|찌르고싶대|찌르고싶다고|찌르겠다고|찌른다고|찌를것같|때리려고|때리고싶대|때리고싶다고|때리겠다고|때린다고|때릴것같)/.test(compact);
  const selfHarmNegated = [
    /(자살|자해)(할)?생각(은|이)?(전혀|절대|조금도)?없/,
    /(죽고싶|살기싫|나를해치고싶|내몸을해치고싶)(은|다는)?(생각|마음)?(은|이)?(전혀|절대)?없/,
    /(죽고싶|살기싫|해치고싶)(지|지는)않/,
    /(삶|인생)(을|를)?포기.{0,6}싶(지|지는)않/,
  ].some((pattern) => pattern.test(compact));
  const selfHarmAttemptNegated = /자살(을|를)?시도.{0,8}(한적은|한적이|적은|적이)?없/.test(compact);
  const selfHarmAfterContrast = /(지만|했지만|없었는데|아니었는데|했는데|그러나|그런데|하지만|이제|지금|오늘).{0,30}(죽고싶|죽어야겠|죽으려고|죽는게(더)?나|살기싫|살고싶지않|삶을포기|자살|자해|해치고싶|끝내고싶)/.test(compact);
  const restartMetaphor = /(모든걸|지금일을|과거를)끝내고(새롭게|다시)(시작|출발)/.test(compact);
  const selfHarmAttempt = [
    /(약|수면제|농약|독극물)(을|를)?.{0,8}(\d+(알|정|개)|다|한통|많이|과다(하게)?).{0,8}(먹었|삼켰|복용했|마셨)/,
    /(\d+(알|정|개)|다|한통|많이|과다(하게)?).{0,8}(약|수면제|농약|독극물)(을|를)?.{0,8}(먹었|삼켰|복용했|마셨)/,
    /(농약|독극물)(을|를)?.{0,5}(마셨|먹었|삼켰)/,
    /번개탄.{0,8}(피우|폈|켜놓|사용)/,
    /손목(을|를)?(그었|베었|긋고있|베고있)/,
    /(뛰어내리(려고|려해|겠다|기직전)|뛰어내렸)/,
    /(목을매|목을맸|목매달았|목매려고|목숨을끊|죽으려고|죽어야겠|죽어버릴|죽을래)/,
    /(칼|흉기).{0,10}(제몸|내몸|몸).{0,6}(찔렀|베었|찌르고있)/,
    /자살(하려|하러|할거|하겠|시도|준비|계획)/,
    /자살(을|를)?시도(를|을)?(했|했고|한|하려|중)/,
    /자해(를|을)?(했|시도(를|을)?했|시도하려|하고있|하려)/,
    /극단적선택(을|를)?시도(를|을)?(했|했고|하려)/,
    /자살.{0,10}(구체적인)?계획.{0,6}(있|세웠|정했)/,
    /(오늘|지금).{0,6}죽(을|는)?계획.{0,6}(있|이에|세웠)/,
    /(유서)(를|를)?(쓰고있|썼|작성했)/,
  ].some((pattern) => pattern.test(compact));
  const selfHarmThought = [
    /죽고싶/,
    /죽는게(더)?나/,
    /죽는편이(더)?낫/,
    /(내가|제가|나는|저는)?없어지는게(더)?낫/,
    /(살고싶지않|살기싫|사라지고싶|없어지고싶)/,
    /(더는|이제는)?살(아야할)?이유(가)?없/,
    /죽으면.{0,6}편할(것같|거같|듯)/,
    /(삶|인생)(을|를)?포기.{0,4}(싶|할래|하겠)/,
    /(나|내몸|스스로)(을|를)?해치고싶/,
    /(자살|자해)(할)?(생각|충동).{0,5}(들|나|있|떠오르)/,
    /(자살|자해)(하고싶|하고싶어|할까)/,
    /극단적선택(을|을하고)?(하고싶|하려|할거)/,
    /(모든걸|그냥)끝내고싶/,
  ].some((pattern) => pattern.test(compact));
  const rawSelfHarm = ((selfHarmAttempt && !selfHarmAttemptNegated)
    || (selfHarmThought && (!selfHarmNegated || selfHarmAfterContrast) && !restartMetaphor))
    && !reportedOtherThreat && !directVictimThreat;
  const selfHarm = rawSelfHarm && (source === 'concern' || !academicQuestion || personalCrisis);

  const harmToOthersNegated = /(죽이|해치|찌르|때리).{0,18}(고싶지않|(고싶은)?(생각|마음)?(은|이)?(전혀|절대|조금도)?없|지는않|지않)/.test(compact);
  const harmToOthersAfterContrast = /(지만|했지만|없었는데|했는데|그러나|그런데|하지만|이제|지금|오늘).{0,36}(죽이고싶|죽이려고|죽이겠|해치고싶|해칠것같|찌르고싶|때리고싶|때릴것같|죽일계획)/.test(compact);
  const rawHarmToOthers = [
    /(남편|아내|배우자|애인|연인|부모|아빠|엄마|아이|딸|아들|가족|친구|상사|사람|그사람|누군가)(을|를).{0,8}(죽이고싶|죽여버리고싶|죽이려고|죽이겠|죽일계획|죽일까봐|해치고싶|해칠것같|해칠까봐|해치겠|찌르고싶|찌를까봐|찌르겠|때리고싶|때릴것같|때릴까봐|때리겠)/,
    /(남편|아내|배우자|애인|연인|부모|아빠|엄마|아이|딸|아들|가족|친구|상사|사람|그사람|누군가)(죽이고싶|죽이려고|죽이겠|해치고싶|해칠것같|찌르고싶|때리고싶|때릴것같)/,
    /(누구|사람)(를|을).{0,8}(죽이려고|죽이겠|죽일계획|죽일까봐|해치겠|해칠까봐|찌르겠|찌를까봐|때리겠|때릴까봐)/,
    /(칼|흉기)(로|을|를)?.{0,8}(사람을)?(찌르고싶|해치고싶|죽이고싶)/,
  ].some((pattern) => pattern.test(compact));
  const harmToOthers = rawHarmToOthers && !reportedOtherThreat
    && (!harmToOthersNegated || harmToOthersAfterContrast)
    && (source === 'concern' || !academicQuestion || personalCrisis);

  const violenceNegated = [
    /(때리|맞|폭행|손찌검|목을조|목졸|협박|감금|스토킹)(지|지는|은적이|한적이)?(않|없)/,
    /학대(받|당)?(지|지는)않/,
    /(폭행|성희롱|성폭력|감금|협박|스토킹).{0,10}(당|받).{0,8}(적은|적이)?없/,
    /때리.{0,10}싶(지|지는)않/,
    /(죽이|해치|찌르|때리).{0,18}(고싶은)?(생각|마음)?(은|이)?(전혀|절대|조금도)?없/,
    /(폭력|가정폭력|교제폭력|데이트폭력)(은|이)?(전혀|절대)?없/,
  ].some((pattern) => pattern.test(compact));
  const violenceAfterContrast = /(지만|했지만|없었는데|아니었는데|했는데|그러나|그런데|하지만|이제|지금|오늘).{0,32}(맞고있|한테맞|에게맞|때리|때렸|때려|폭행|손찌검|발로차|밀쳤|목을조|목졸|위협|협박|감금|스토킹|학대)/.test(compact);
  const violenceAction = reportedOtherThreat || directVictimThreat || [
    /(맞고있|맞아서|맞는중|한테맞|에게맞|폭행(을|를)?당|폭행.{0,8}피해.{0,5}입)/,
    /(남편|아내|배우자|애인|연인|남자친구|여자친구|부모|아빠|엄마|가해자|상대|누군가).{0,12}(때리|때릴|때렸|때려|폭행|폭력(을)?(쓰|써)|밀어|밀었|밀어요|죽이려고|죽일|죽이겠다고|해치려고|해칠)/,
    /(나는|내가|나를|나한테|내게|저는|제가|저를|저한테|저에게|제게|우리(아이|딸|아들)|아이|딸|아들|엄마|아빠).{0,12}(때리|때렸|때려|폭행)/,
    /(손찌검|발로차|밀쳤|밀치고|목을조|목졸|목을졸랐)/,
    /(칼|흉기).{0,12}(위협|협박|들고쫓|들고따라|들고와)/,
    /(성폭행|성폭력|성추행|성희롱|강간).{0,8}(당|피해|했|해)/,
    /(불법촬영|몰카).{0,8}(당|피해|찍)/,
    /(학대받|학대당|스토킹(을|를)?당|스토킹.{0,8}피해.{0,5}입|감금(을|를)?당|감금됐|협박받|협박(을|를)?받|협박(을|를)?당|가둬)/,
    /(가정폭력|교제폭력|데이트폭력).{0,10}(당|피해|있|계속|때문|두렵)/,
    /죽이겠다고.{0,6}(위협|협박)/,
  ].some((pattern) => pattern.test(compact));
  const violence = violenceAction && (!violenceNegated || violenceAfterContrast)
    && (source === 'concern' || !academicQuestion || personalCrisis);
  const explicitVictim = [
    /(맞고있|맞아서|맞는중|한테맞|에게맞|폭행(을|를)?당|폭행.{0,8}피해.{0,5}입)/,
    /(나를|저를|나한테|저한테|내게|저에게|제게).{0,16}(때리|때릴|때렸|때려|죽이려|죽일|해치려|해칠|폭행|손찌검|발로차|밀쳤|목을조|목졸|협박|감금)/,
    /(나는|내가|저는|제가).{0,12}(맞고|맞았|폭행당|성폭력당|감금당|협박받|스토킹당)/,
  ].some((pattern) => pattern.test(compact)) && (!violenceNegated || violenceAfterContrast)
    && (source === 'concern' || !academicQuestion || personalCrisis);

  if (harmToOthers && (selfHarm || explicitVictim)) return 'complex_danger';
  if (harmToOthers) return 'harm_to_others';
  if (selfHarm && violence) return 'both';
  if (selfHarm) return 'self_harm';
  if (violence) return 'violence';
  return null;
}

function recommendConcern(value: string): CareResult {
  const urgent = detectUrgency(value);
  if (urgent === 'self_harm' || urgent === 'both' || urgent === 'harm_to_others' || urgent === 'complex_danger') return { topic: SELF_HARM_TOPIC, urgent };
  if (urgent === 'violence') return { topic: VIOLENCE_TOPIC, urgent };
  const compact = normalizedConcern(value);

  let best = GENERAL_CARE_TOPIC;
  let bestScore = 0;
  for (const topic of CARE_TOPICS) {
    const score = topic.keywords.reduce((total, keyword) => {
      const token = normalizedConcern(keyword);
      return compact.includes(token) ? total + Math.max(2, token.length) : total;
    }, 0);
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return { topic: best, urgent: null };
}

function readSavedReferences() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem('word-guide-saved') || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function isSermon(value: unknown): value is Sermon {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const manuscript = item.manuscript as Record<string, unknown> | undefined;
  const manuscriptSections = manuscript?.sections;
  const manuscriptText = manuscript && Array.isArray(manuscriptSections)
    ? [
        ...(Array.isArray(manuscript.introduction) ? manuscript.introduction : []),
        ...manuscriptSections.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const section = entry as Record<string, unknown>;
          return [
            ...(Array.isArray(section.paragraphs) ? section.paragraphs : []),
            typeof section.bridgeToNext === 'string' ? section.bridgeToNext : '',
          ];
        }),
        ...(Array.isArray(manuscript.gospelConnection) ? manuscript.gospelConnection : []),
        ...(Array.isArray(manuscript.conclusion) ? manuscript.conclusion : []),
        typeof manuscript.closingPrayer === 'string' ? manuscript.closingPrayer : '',
      ].filter((entry): entry is string => typeof entry === 'string').join('')
    : '';
  const validManuscript = Boolean(manuscript)
    && Number.isInteger(manuscript?.estimatedMinutes) && Number(manuscript?.estimatedMinutes) >= 9 && Number(manuscript?.estimatedMinutes) <= 18
    && Array.isArray(manuscript?.introduction) && manuscript.introduction.length >= 3 && manuscript.introduction.every((entry) => typeof entry === 'string')
    && Array.isArray(manuscriptSections) && manuscriptSections.length >= 1 && manuscriptSections.length <= 6 && manuscriptSections.every((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const section = entry as Record<string, unknown>;
      return Number.isInteger(section.start) && Number(section.start) >= 1
        && Number.isInteger(section.end) && Number(section.end) >= Number(section.start)
        && typeof section.heading === 'string' && typeof section.bridgeToNext === 'string'
        && Array.isArray(section.paragraphs) && section.paragraphs.length >= 3 && section.paragraphs.every((paragraph) => typeof paragraph === 'string');
    })
    && Array.isArray(manuscript?.gospelConnection) && manuscript.gospelConnection.length >= 1 && manuscript.gospelConnection.every((entry) => typeof entry === 'string')
    && Array.isArray(manuscript?.conclusion) && manuscript.conclusion.length >= 2 && manuscript.conclusion.every((entry) => typeof entry === 'string')
    && typeof manuscript?.closingPrayer === 'string'
    && manuscriptText.length >= 2600;

  return validManuscript
    && ['title', 'summary', 'opening', 'context', 'illustration', 'caution', 'decision', 'prayer'].every((key) => typeof item[key] === 'string')
    && Array.isArray(item.passageSections) && item.passageSections.length >= 1 && item.passageSections.length <= 6 && item.passageSections.every((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const section = entry as Record<string, unknown>;
      return Number.isInteger(section.start) && Number(section.start) >= 1
        && Number.isInteger(section.end) && Number(section.end) >= Number(section.start)
        && typeof section.title === 'string' && typeof section.explanation === 'string';
    })
    && Array.isArray(item.points) && item.points.length === 3 && item.points.every((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const point = entry as Record<string, unknown>;
      return typeof point.title === 'string' && typeof point.body === 'string';
    })
    && Array.isArray(item.crossReferences) && item.crossReferences.length === 2 && item.crossReferences.every((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const crossReference = entry as Record<string, unknown>;
      return typeof crossReference.reference === 'string' && typeof crossReference.connection === 'string';
    })
    && Array.isArray(item.applications) && item.applications.length === 3 && item.applications.every((entry) => typeof entry === 'string')
    && Array.isArray(item.questions) && item.questions.length === 3 && item.questions.every((entry) => typeof entry === 'string');
}

function passageSectionsCover(sections: Array<{ start: number; end: number }>, start: number, end: number) {
  return sections[0]?.start === start
    && sections.at(-1)?.end === end
    && sections.every((section, index) => index === 0 || section.start === sections[index - 1].end + 1);
}

function manuscriptCoversPassage(manuscript: Sermon['manuscript'], sections: Sermon['passageSections'], start: number, end: number) {
  return passageSectionsCover(manuscript.sections, start, end)
    && manuscript.sections.length === sections.length
    && manuscript.sections.every((section, index) => section.start === sections[index].start && section.end === sections[index].end);
}

function isLocalAiPayload(value: unknown): value is LocalAiPayload {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.topicId === 'string'
    && (item.urgent === 'none' || item.urgent === 'self_harm' || item.urgent === 'violence' || item.urgent === 'both' || item.urgent === 'harm_to_others' || item.urgent === 'complex_danger')
    && isSermon(item.sermon);
}

function readCachedSermon(ref: string) {
  if (typeof window === 'undefined') return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SERMON_CACHE_KEY) || '[]');
    if (!Array.isArray(parsed)) return null;
    const found = parsed.find((entry) => entry && typeof entry === 'object'
      && (entry as Record<string, unknown>).version === SERMON_CACHE_VERSION
      && (entry as Record<string, unknown>).source === 'local-ai'
      && (entry as Record<string, unknown>).ref === ref) as Record<string, unknown> | undefined;
    return found && isSermon(found.sermon) ? found.sermon : null;
  } catch {
    return null;
  }
}

function cacheGeneratedSermon(ref: string, sermon: Sermon) {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SERMON_CACHE_KEY) || '[]');
    const current = Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).ref !== ref) : [];
    const updated = [{ version: SERMON_CACHE_VERSION, source: 'local-ai', ref, sermon, savedAt: Date.now() }, ...current].slice(0, 36);
    window.localStorage.setItem(SERMON_CACHE_KEY, JSON.stringify(updated));
  } catch {
    // A sermon still remains available for the current session if device storage is full.
  }
}

function urgentGuidance(urgent: NonNullable<CareResult['urgent']>) {
  if (urgent === 'complex_danger') return '지금은 여러 생명과 안전이 함께 위험할 수 있어요. 칼이나 위험한 물건을 내려놓고 상대와 떨어지며, 가해자가 있다면 맞서지 말고 안전한 곳으로 이동하세요. 112·119 또는 가까운 응급실에 먼저 연락하고 혼자 있지 마세요. 자살 위기 상담 109와 여성긴급전화 1366의 도움도 받을 수 있습니다.';
  if (urgent === 'harm_to_others') return '지금 다른 사람을 해칠 수 있다면 말씀 설명보다 즉시 거리를 두는 일이 먼저예요. 칼이나 위험한 물건을 내려놓고 상대에게 다가가지 마세요. 운전하지 말고 경찰 112 또는 구급 119에 지금 상황을 알린 뒤, 가까운 응급실이나 믿을 만한 사람의 도움을 받아 혼자 있지 마세요.';
  if (urgent === 'both') return '지금은 말씀 설명보다 생명과 안전이 먼저예요. 이미 다쳤거나 약을 복용했거나 실행 직전이라면 119·112 또는 가까운 응급실에 먼저 연락하세요. 혼자 있지 말고 가해자와 떨어진 안전한 곳으로 이동한 뒤 자살예방 상담전화 109와 여성긴급전화 1366의 도움도 받을 수 있어요.';
  return urgent === 'self_harm'
    ? '지금은 말씀 설명보다 안전이 먼저예요. 이미 다쳤거나 약을 복용했거나 실행 직전이라면 119·112 또는 가까운 응급실에 먼저 연락하세요. 혼자 있지 말고 위험한 물건과 장소에서 떨어진 뒤, 24시간 자살예방 상담전화 109에도 도움을 요청해 주세요.'
    : '폭력·성폭력·스토킹·감금·협박은 용서나 관계 갈등으로만 다룰 일이 아니에요. 가해자와 혼자 대면하지 말고 가능한 안전한 곳으로 이동하세요. 당장 다쳤거나 위험하면 119·112에 먼저 연락하고, 여성긴급전화 1366의 도움도 받을 수 있어요.';
}

function splitForSpeech(value: string, limit = 240) {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining.length > limit) {
    const preferred = remaining.lastIndexOf(' ', limit);
    const cut = preferred >= Math.floor(limit * 0.55) ? preferred : limit;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function scriptureSpeechChunks(ref: string, verses: PassageVerse[]) {
  const spokenRef = ref.replace(/(\d+)–(\d+)절/, '$1절에서 $2절');
  return [`본문 전체. ${spokenRef}.`, ...verses.map((verse) => `${verse.number}절. ${verse.text}`)]
    .flatMap((section) => splitForSpeech(section));
}

function speechChunks(ref: string, sermon: Sermon, urgent: CareResult['urgent']) {
  const spokenRef = ref.replace(/(\d+)–(\d+)절/, '$1절에서 $2절');
  const safety = urgent === 'self_harm'
    ? ['긴급 안전 안내. 이미 다쳤거나 약을 복용했거나 실행 직전이라면 구급 119, 경찰 112 또는 가까운 응급실에 먼저 연락하세요. 혼자 있지 말고 위험한 물건이나 장소에서 떨어진 뒤, 24시간 자살예방 상담전화 109에도 도움을 요청해 주세요. 말씀 추천은 긴급한 도움을 대신하지 않습니다.']
    : urgent === 'violence'
      ? ['긴급 안전 안내. 가해자와 혼자 대면하지 말고 가능한 안전한 곳으로 이동하세요. 당장 다쳤거나 위험하면 구급 119 또는 경찰 112에 먼저 연락하고, 여성긴급전화 1366에도 도움을 요청할 수 있습니다. 용서나 교회 안의 해결보다 피해자의 안전이 먼저입니다.']
      : urgent === 'both'
        ? ['긴급 안전 안내. 지금은 생명과 안전이 먼저입니다. 이미 다쳤거나 약을 복용했거나 실행 직전이라면 구급 119, 경찰 112 또는 가까운 응급실에 먼저 연락하세요. 혼자 있지 말고 가해자와 떨어진 안전한 곳으로 이동한 뒤, 24시간 자살예방 상담전화 109와 여성긴급전화 1366의 도움도 받을 수 있습니다.']
        : urgent === 'harm_to_others'
          ? ['긴급 안전 안내. 지금 다른 사람을 해칠 수 있다면 칼이나 위험한 물건을 내려놓고 상대에게 다가가지 마세요. 운전하지 말고 경찰 112 또는 구급 119에 지금 상황을 알린 뒤, 가까운 응급실이나 믿을 만한 사람의 도움을 받아 혼자 있지 마세요.']
          : urgent === 'complex_danger'
            ? ['긴급 안전 안내. 지금은 여러 생명과 안전이 함께 위험할 수 있습니다. 칼이나 위험한 물건을 내려놓고 상대와 떨어지며, 가해자가 있다면 맞서지 말고 안전한 곳으로 이동하세요. 경찰 112, 구급 119 또는 가까운 응급실에 먼저 연락하고 혼자 있지 마세요. 자살 위기 상담 109와 여성긴급전화 1366의 도움도 받을 수 있습니다.']
            : [];
  if (safety.length) return safety.flatMap((item) => splitForSpeech(item));
  const sections = [
    `${spokenRef}. 오늘의 설교 제목은 ${sermon.title}입니다.`,
    ...sermon.manuscript.introduction,
    sermon.context,
    ...sermon.manuscript.sections.flatMap((section) => [...section.paragraphs, section.bridgeToNext]),
    ...sermon.manuscript.gospelConnection,
    ...sermon.manuscript.conclusion,
    '이제 말씀을 마음에 품고 함께 기도하겠습니다.',
    sermon.manuscript.closingPrayer,
  ];

  return sections.flatMap((section) => {
    if (section.length <= 240) return [section];
    const sentences = (section.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [section]).flatMap((sentence) => splitForSpeech(sentence));
    const chunks: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > 240) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  });
}

export default function Home() {
  const [book, setBook] = useState(BOOKS.find((item) => item.name === '잠언')!);
  const [chapter, setChapter] = useState(1);
  const [startVerse, setStartVerse] = useState(1);
  const [endVerse, setEndVerse] = useState(33);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draftBook, setDraftBook] = useState(book);
  const [draftChapter, setDraftChapter] = useState(chapter);
  const [draftStart, setDraftStart] = useState(startVerse);
  const [draftEnd, setDraftEnd] = useState(endVerse);
  const [testament, setTestament] = useState<'전체' | '구약' | '신약'>('전체');
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedReferences, setSavedReferences] = useState<string[]>([]);
  const [fontScale, setFontScale] = useState(1);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [answering, setAnswering] = useState(false);
  const [notice, setNotice] = useState('');
  const [concern, setConcern] = useState('');
  const [heartFinderOpen, setHeartFinderOpen] = useState(false);
  const [careResult, setCareResult] = useState<CareResult | null>(null);
  const [ttsStatus, setTtsStatus] = useState<TtsStatus>('idle');
  const [ttsTarget, setTtsTarget] = useState<TtsTarget>('sermon');
  const [mobileTab, setMobileTab] = useState<MobileTab>('bible');
  const [sermonReady, setSermonReady] = useState(false);
  const [passageStatus, setPassageStatus] = useState<PassageStatus>('loading');
  const [passageVerses, setPassageVerses] = useState<PassageVerse[]>([]);
  const [passageReload, setPassageReload] = useState(0);
  const [localAiConnection, setLocalAiConnection] = useState<LocalAiConnection>({ baseUrl: DEFAULT_LOCAL_AI_BASE, token: DEFAULT_LOCAL_AI_TOKEN });
  const [localAiDraft, setLocalAiDraft] = useState<LocalAiConnection>({ baseUrl: DEFAULT_LOCAL_AI_BASE, token: DEFAULT_LOCAL_AI_TOKEN });
  const [localAiSettingsOpen, setLocalAiSettingsOpen] = useState(false);
  const [localAiChecking, setLocalAiChecking] = useState(false);
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiStatus>(DEFAULT_LOCAL_AI_TOKEN ? 'checking' : 'unconfigured');
  const [generationIssue, setGenerationIssue] = useState<GenerationIssue | null>(null);
  const [customSermon, setCustomSermon] = useState<{ ref: string; sermon: Sermon } | null>(null);
  const generationRequest = useRef(0);
  const questionRequest = useRef(0);
  const timers = useRef<Set<number>>(new Set());
  const noticeTimer = useRef<number | null>(null);
  const ttsRun = useRef(0);
  const koreanVoice = useRef<SpeechSynthesisVoice | null>(null);
  const nativeTtsProgress = useRef({ queue: [] as string[], index: 0, offset: 0, baseOffset: 0 });
  const nativeRangeActive = useRef(false);
  const nativeTtsWarmup = useRef<ReturnType<typeof prepareNativeKoreanVoice> | null>(null);
  const localAiAbort = useRef<AbortController | null>(null);
  const urgentCareRef = useRef<HTMLDivElement | null>(null);
  const bibleCache = useRef<Map<string, string[][]>>(new Map());

  const ref = reference(book, chapter, startVerse, endVerse);
  const localPersonalMode = Boolean(localAiConnection.baseUrl.trim() && localAiConnection.token.trim());
  const curatedSermonAvailable = Boolean(CURATED[`${book.name}-${chapter}-${startVerse}-${endVerse}`]?.manuscript);
  const generatedSermonAvailable = customSermon?.ref === ref;
  const completeSermonAvailable = curatedSermonAvailable || generatedSermonAvailable;
  const activeCareTopic = !careResult?.urgent && careResult?.topic.book === book.name
    && careResult.topic.chapter === chapter
    && careResult.topic.start === startVerse
    && careResult.topic.end === endVerse
    ? careResult.topic
    : undefined;
  const preparedSermon = useMemo(() => makeSermon(book, chapter, startVerse, endVerse, activeCareTopic), [book, chapter, startVerse, endVerse, activeCareTopic]);
  const sermon = customSermon?.ref === ref ? customSermon.sermon : preparedSermon;
  const saved = savedReferences.includes(ref);
  const draftVerseLimit = getVerseCount(draftBook.name, draftChapter);
  const draftUnits = useMemo(() => getPassageUnits(draftBook.name, draftChapter), [draftBook, draftChapter]);
  const filteredBooks = useMemo(() => BOOKS.filter((item) => {
    const matchesTestament = testament === '전체' || item.testament === testament;
    const term = search.trim();
    return matchesTestament && (!term || item.name.includes(term) || item.short.includes(term));
  }), [search, testament]);

  useEffect(() => {
    const bookIndex = BOOKS.findIndex((item) => item.name === book.name);
    const code = BIBLE_CODES[bookIndex];
    const controller = new AbortController();
    let active = true;

    const selectPassage = (chapters: string[][]) => {
      const chapterText = chapters[chapter - 1];
      const expectedCount = getVerseCount(book.name, chapter);
      if (!Array.isArray(chapterText) || chapterText.length !== expectedCount) throw new Error('invalid_chapter_text');
      const selected = chapterText.slice(startVerse - 1, endVerse);
      if (selected.length !== endVerse - startVerse + 1 || selected.some((text) => typeof text !== 'string' || !text.trim())) {
        throw new Error('invalid_selected_text');
      }
      if (!active) return;
      setPassageVerses(selected.map((text, index) => ({ number: startVerse + index, text })));
      setPassageStatus('ready');
    };

    const loadPassage = async () => {
      setPassageStatus('loading');
      setPassageVerses([]);
      try {
        const cached = bibleCache.current.get(code);
        if (cached) {
          selectPassage(cached);
          return;
        }
        const response = await fetch(`/bible/playx/${code}.json`, { signal: controller.signal });
        if (!response.ok) throw new Error(`bible_${response.status}`);
        const payload: BibleBookFile = await response.json();
        if (payload.book !== book.name || payload.code !== code || !Array.isArray(payload.chapters)) throw new Error('invalid_bible_file');
        bibleCache.current.set(code, payload.chapters);
        selectPassage(payload.chapters);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        console.error('[bible-text]', error);
        setPassageStatus('error');
      }
    };

    void loadPassage();
    return () => {
      active = false;
      controller.abort();
    };
  }, [book, chapter, startVerse, endVerse, passageReload]);

  const schedule = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, delay);
    timers.current.add(timer);
    return timer;
  };

  const showNotice = (message: string, delay = 2200) => {
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
      timers.current.delete(noticeTimer.current);
    }
    setNotice(message);
    noticeTimer.current = schedule(() => {
      setNotice('');
      noticeTimer.current = null;
    }, delay);
  };

  const requestLocalAi = async (path: '/sermon' | '/passage', payload: object, signal: AbortSignal): Promise<LocalGenerationResponse> => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const baseUrl = normalizedLocalAiBase(localAiConnection.baseUrl);
    const headers = { 'Content-Type': 'application/json', 'X-Bible-Local-Token': localAiConnection.token };
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.post({
        url: `${baseUrl}${path}`,
        headers,
        data: payload,
        connectTimeout: 15_000,
        readTimeout: 190_000,
      });
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return { ok: response.status >= 200 && response.status < 300, status: response.status, data: response.data };
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    let data: unknown = null;
    try { data = await response.json(); } catch { data = null; }
    return { ok: response.ok, status: response.status, data };
  };

  const fetchLocalGeneration = async (path: '/sermon' | '/passage', payload: object, signal: AbortSignal) => {
    let lastResponse: LocalGenerationResponse | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      lastResponse = await requestLocalAi(path, payload, signal);
      if (lastResponse.status !== 429 || attempt === 5) return lastResponse;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await new Promise<void>((resolve, reject) => {
        const finishWaiting = () => {
          signal.removeEventListener('abort', stopWaiting);
          resolve();
        };
        const retryTimer = window.setTimeout(finishWaiting, 400 * (attempt + 1));
        const stopWaiting = () => {
          window.clearTimeout(retryTimer);
          signal.removeEventListener('abort', stopWaiting);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', stopWaiting, { once: true });
      });
    }
    return lastResponse!;
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = Number(window.localStorage.getItem('word-guide-font'));
      if (Number.isFinite(stored) && stored >= 0.9 && stored <= 1.3) setFontScale(stored);
      setSavedReferences(readSavedReferences());
      try {
        const savedConnection = JSON.parse(window.localStorage.getItem(LOCAL_AI_STORAGE_KEY) || 'null') as Partial<LocalAiConnection> | null;
        if (savedConnection && typeof savedConnection.baseUrl === 'string' && typeof savedConnection.token === 'string') {
          const restored = { baseUrl: normalizedLocalAiBase(savedConnection.baseUrl), token: savedConnection.token.trim() };
          if (restored.token) {
            setLocalAiConnection(restored);
            setLocalAiDraft(restored);
          }
        }
      } catch {
        window.localStorage.removeItem(LOCAL_AI_STORAGE_KEY);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!localPersonalMode) return;
    let active = true;
    void requestLocalAiHealth(localAiConnection).then((status) => {
      if (active) setLocalAiStatus(status >= 200 && status < 300 ? 'connected' : 'offline');
    }).catch(() => {
      if (active) setLocalAiStatus('offline');
    });
    return () => { active = false; };
  }, [localAiConnection, localPersonalMode]);

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      pendingTimers.forEach((timer) => window.clearTimeout(timer));
      pendingTimers.clear();
      generationRequest.current += 1;
      questionRequest.current += 1;
      localAiAbort.current?.abort();
      ttsRun.current += 1;
      nativeRangeActive.current = false;
      if (Capacitor.isNativePlatform()) {
        void getNativeTextToSpeech().then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => undefined);
      }
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.resume();
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    nativeTtsWarmup.current ??= prepareNativeKoreanVoice();
    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;
    void getNativeTextToSpeech().then(({ TextToSpeech }) => TextToSpeech.addListener('onRangeStart', ({ start }) => {
        if (nativeRangeActive.current) {
          nativeTtsProgress.current.offset = nativeTtsProgress.current.baseOffset + start;
        }
      })).then((handle) => {
        if (disposed) void handle.remove();
        else listener = handle;
      }).catch(() => undefined);
    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, []);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const selectKoreanVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      koreanVoice.current = voices.find((item) => item.lang.toLowerCase() === 'ko-kr' && item.default)
        ?? voices.find((item) => item.lang.toLowerCase() === 'ko-kr' && item.localService)
        ?? voices.find((item) => item.lang.toLowerCase().split('-')[0] === 'ko')
        ?? null;
    };
    selectKoreanVoice();
    window.speechSynthesis.addEventListener('voiceschanged', selectKoreanVoice);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', selectKoreanVoice);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openPicker = () => {
    setDraftBook(book);
    setDraftChapter(chapter);
    setDraftStart(startVerse);
    setDraftEnd(endVerse);
    setSearch('');
    setTestament('전체');
    setPickerOpen(true);
  };

  const selectMobileTab = (nextTab: MobileTab) => {
    setMobileTab(nextTab);
    setHeartFinderOpen(nextTab === 'heart');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stopSpeech = () => {
    ttsRun.current += 1;
    nativeRangeActive.current = false;
    nativeTtsProgress.current = { queue: [], index: 0, offset: 0, baseOffset: 0 };
    if (Capacitor.isNativePlatform()) {
      void getNativeTextToSpeech().then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => undefined);
    }
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.resume();
    setTtsStatus('idle');
  };

  const startSpeech = (target: TtsTarget = 'sermon') => {
    if (target === 'sermon' && !completeSermonAvailable) {
      setMobileTab('sermon');
      showNotice('실제 AI 설교가 완성된 뒤에 음성으로 들을 수 있어요.', 3200);
      return;
    }
    if (passageStatus !== 'ready') {
      showNotice('본문을 불러온 뒤 다시 눌러 주세요.', 2600);
      return;
    }
    const queue = target === 'scripture'
      ? scriptureSpeechChunks(ref, passageVerses)
      : speechChunks(ref, sermon, careResult?.urgent ?? null);

    const startWebSpeech = () => {
      nativeRangeActive.current = false;
      if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
        setTtsStatus('idle');
        showNotice('이 기기는 음성 읽기를 지원하지 않아요. 기기의 한국어 음성 설정을 확인해 주세요.', 3500);
        return;
      }
      if (ttsStatus === 'paused' && ttsTarget === target) {
        if (window.speechSynthesis.paused && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
          window.speechSynthesis.resume();
          return;
        }
      }

      ttsRun.current += 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      const runId = ++ttsRun.current;
      const voice = koreanVoice.current;
      setTtsTarget(target);

      const speakAt = (index: number) => {
        if (runId !== ttsRun.current) return;
        if (index >= queue.length) {
          setTtsStatus('idle');
          showNotice(target === 'scripture' ? '본문을 끝까지 읽었어요.' : '설교를 끝까지 읽었어요.');
          return;
        }
        const utterance = new SpeechSynthesisUtterance(queue[index]);
        utterance.lang = 'ko-KR';
        utterance.rate = 0.94;
        utterance.pitch = 1;
        utterance.volume = 0.85;
        if (voice) utterance.voice = voice;
        utterance.onstart = () => {
          if (runId === ttsRun.current) setTtsStatus('playing');
        };
        utterance.onpause = () => {
          if (runId === ttsRun.current) setTtsStatus('paused');
        };
        utterance.onresume = () => {
          if (runId === ttsRun.current) setTtsStatus('playing');
        };
        utterance.onend = () => speakAt(index + 1);
        utterance.onerror = (event) => {
          if (runId !== ttsRun.current) return;
          ttsRun.current += 1;
          setTtsStatus('idle');
          if (event.error !== 'canceled' && event.error !== 'interrupted') {
            showNotice('음성 읽기를 시작하지 못했어요. 기기 음량과 한국어 음성 설정을 확인해 주세요.', 3500);
          }
        };
        window.speechSynthesis.speak(utterance);
      };

      setTtsStatus('loading');
      speakAt(0);
    };

    if (Capacitor.isNativePlatform()) {
      const continuing = ttsStatus === 'paused' && ttsTarget === target && nativeTtsProgress.current.queue.length > 0;
      const runId = ++ttsRun.current;
      nativeRangeActive.current = false;
      setTtsTarget(target);
      setTtsStatus('loading');

      const warmup = nativeTtsWarmup.current ?? prepareNativeKoreanVoice();
      nativeTtsWarmup.current = warmup;
      void warmup.then(async ({ TextToSpeech, supported }) => {
        if (runId !== ttsRun.current) return;
        if (!supported) {
          nativeRangeActive.current = false;
          setTtsStatus('idle');
          showNotice('한국어 음성이 설치되어 있지 않아 설치 화면을 열어요.', 4000);
          await TextToSpeech.openInstall();
          nativeTtsWarmup.current = null;
          return;
        }
        if (ttsStatus !== 'idle') {
          await TextToSpeech.stop().catch(() => undefined);
          if (runId !== ttsRun.current) return;
        }
        if (!continuing) {
          nativeTtsProgress.current = { queue, index: 0, offset: 0, baseOffset: 0 };
        }
        const progress = nativeTtsProgress.current;

        const speakNativeAt = (index: number, offset: number) => {
          if (runId !== ttsRun.current) return;
          if (index >= progress.queue.length) {
            nativeRangeActive.current = false;
            nativeTtsProgress.current = { queue: [], index: 0, offset: 0, baseOffset: 0 };
            setTtsStatus('idle');
            showNotice(target === 'scripture' ? '본문을 끝까지 읽었어요.' : '설교를 끝까지 읽었어요.');
            return;
          }
          const text = progress.queue[index].slice(offset);
          if (!text.trim()) {
            speakNativeAt(index + 1, 0);
            return;
          }
          progress.index = index;
          progress.offset = offset;
          progress.baseOffset = offset;
          nativeRangeActive.current = true;
          setTtsStatus('playing');
          void TextToSpeech.speak({ text, lang: 'ko-KR', rate: 0.94, pitch: 1, volume: 0.85 }).then(() => {
            if (runId === ttsRun.current) speakNativeAt(index + 1, 0);
          }).catch(() => {
            if (runId !== ttsRun.current) return;
            ttsRun.current += 1;
            nativeRangeActive.current = false;
            setTtsStatus('idle');
            showNotice('안드로이드 음성 대신 기기의 기본 음성으로 읽어드릴게요.', 3000);
            startWebSpeech();
          });
        };

        speakNativeAt(progress.index, progress.offset);
      }).catch(() => {
        if (runId !== ttsRun.current) return;
        nativeRangeActive.current = false;
        showNotice('안드로이드 음성 대신 기기의 기본 음성으로 읽어드릴게요.', 3000);
        startWebSpeech();
      });
      return;
    }

    startWebSpeech();
  };

  const pauseSpeech = () => {
    if (Capacitor.isNativePlatform()) {
      ttsRun.current += 1;
      nativeRangeActive.current = false;
      void getNativeTextToSpeech().then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => undefined);
      setTtsStatus('paused');
      return;
    }
    window.speechSynthesis?.pause();
    setTtsStatus('paused');
  };

  const prepareReading = async (nextBook: Book, nextChapter: number, nextStart: number, nextEnd: number) => {
    const nextRef = reference(nextBook, nextChapter, nextStart, nextEnd);
    const bundled = Boolean(CURATED[`${nextBook.name}-${nextChapter}-${nextStart}-${nextEnd}`]?.manuscript);
    stopSpeech();
    setMobileTab('bible');
    setHeartFinderOpen(false);
    setSermonReady(false);
    localAiAbort.current?.abort();
    const requestId = ++generationRequest.current;
    questionRequest.current += 1;
    setAnswering(false);
    setBook(nextBook);
    setChapter(nextChapter);
    setStartVerse(nextStart);
    setEndVerse(nextEnd);
    setCareResult(null);
    setCustomSermon(null);
    setGenerationIssue(null);
    setQuestion('');
    setChat([]);
    setIsGenerating(true);

    const cachedSermon = readCachedSermon(nextRef);
    if (cachedSermon
      && passageSectionsCover(cachedSermon.passageSections, nextStart, nextEnd)
      && manuscriptCoversPassage(cachedSermon.manuscript, cachedSermon.passageSections, nextStart, nextEnd)) {
      setCustomSermon({ ref: nextRef, sermon: cachedSermon });
      setGenerationIssue(null);
      setIsGenerating(false);
      setSermonReady(true);
      showNotice('전에 준비한 설교를 불러왔어요.', 2400);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (localPersonalMode) {
      const controller = new AbortController();
      localAiAbort.current = controller;
      const timeout = schedule(() => controller.abort(), 195_000);
      let reachedServer = false;
      try {
        const response = await fetchLocalGeneration('/passage', { book: nextBook.name, chapter: nextChapter, start: nextStart, end: nextEnd }, controller.signal);
        reachedServer = true;
        setLocalAiStatus('connected');
        if (!response.ok) throw new Error(`local_passage_${response.status}`);
        const payload: unknown = response.data;
        if (!isLocalAiPayload(payload) || payload.topicId !== 'passage' || payload.urgent !== 'none'
          || !passageSectionsCover(payload.sermon.passageSections, nextStart, nextEnd)
          || !manuscriptCoversPassage(payload.sermon.manuscript, payload.sermon.passageSections, nextStart, nextEnd)) throw new Error('invalid_local_passage_response');
        if (requestId !== generationRequest.current) return;
        cacheGeneratedSermon(nextRef, payload.sermon);
        setCustomSermon({ ref: nextRef, sermon: payload.sermon });
        setGenerationIssue(null);
        setIsGenerating(false);
        setSermonReady(true);
        showNotice(`${nextRef} 해설을 준비했어요.`, 2600);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      } catch (error) {
        if (requestId !== generationRequest.current) return;
        setIsGenerating(false);
        setSermonReady(bundled);
        if (!bundled) setGenerationIssue(describeGenerationIssue(error, nextRef));
        if (!reachedServer || /_(401|403)$/.test(error instanceof Error ? error.message : String(error))) setLocalAiStatus('offline');
        showNotice(bundled
          ? `PC 연결 대신 앱에 준비된 ${nextRef} 전체 설교를 열었어요.`
          : '실제 AI 설교를 완성하지 못했어요. 임시 원고로 대신하지 않고 연결 상태를 보여드릴게요.', 5200);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      } finally {
        window.clearTimeout(timeout);
        timers.current.delete(timeout);
        if (localAiAbort.current === controller) localAiAbort.current = null;
      }
    }

    setIsGenerating(false);
    setSermonReady(bundled);
    if (!bundled) {
      setGenerationIssue({ ref: nextRef, kind: 'not-configured', message: '이 본문의 실제 설교를 만들려면 휴대폰 앱을 PC의 Codex 말씀 서버와 연결해야 해요.' });
      showNotice('실제 AI 설교를 만들 PC 연결이 필요해요.', 3600);
    } else {
      showNotice(`앱에 준비된 ${nextRef} 전체 설교를 열었어요.`, 2600);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const chooseReading = (reading: typeof QUICK_READINGS[number]) => {
    const nextBook = BOOKS.find((item) => item.name === reading.book)!;
    void prepareReading(nextBook, reading.chapter, reading.start, reading.end);
  };

  const generate = () => {
    const nextBook = draftBook;
    const nextChapter = draftChapter;
    const verseLimit = getVerseCount(nextBook.name, nextChapter);
    const safeStart = Math.max(1, Math.min(verseLimit, Math.trunc(draftStart)));
    const safeEnd = Math.max(safeStart, Math.min(verseLimit, Math.trunc(draftEnd)));
    setPickerOpen(false);
    void prepareReading(nextBook, nextChapter, safeStart, safeEnd);
  };

  const toggleSaved = () => {
    const next = !saved;
    const key = 'word-guide-saved';
    const list = readSavedReferences();
    const updated = next ? Array.from(new Set([ref, ...list])) : list.filter((item) => item !== ref);
    try {
      window.localStorage.setItem(key, JSON.stringify(updated));
      setSavedReferences(updated);
      showNotice(next ? '말씀 범위를 묵상함에 저장했어요.' : '저장을 해제했어요.', 2000);
    } catch {
      showNotice('브라우저 저장 공간을 사용할 수 없어 저장하지 못했어요.', 3000);
    }
  };

  const changeFont = () => {
    const next = fontScale >= 1.16 ? 0.94 : Number((fontScale + 0.11).toFixed(2));
    setFontScale(next);
    window.localStorage.setItem('word-guide-font', String(next));
    showNotice(`본문 글자 크기를 ${next > 1.1 ? '크게' : next > 1 ? '보통보다 조금 크게' : '보통으로'} 바꿨어요.`);
  };

  const connectLocalAi = async () => {
    setLocalAiChecking(true);
    setLocalAiStatus('checking');
    try {
      const next = { baseUrl: normalizedLocalAiBase(localAiDraft.baseUrl), token: localAiDraft.token.trim() };
      if (!next.token) throw new Error('missing_connection_token');
      const status = await requestLocalAiHealth(next);
      if (status < 200 || status >= 300) throw new Error(`health_${status}`);
      setLocalAiConnection(next);
      setLocalAiDraft(next);
      setLocalAiStatus('connected');
      window.localStorage.setItem(LOCAL_AI_STORAGE_KEY, JSON.stringify(next));
      setLocalAiSettingsOpen(false);
      showNotice('개인용 AI 설교 서버와 연결됐어요.', 3000);
    } catch {
      setLocalAiStatus(localAiDraft.token.trim() ? 'offline' : 'unconfigured');
      showNotice('연결하지 못했어요. PC의 주소와 연결 코드를 확인해 주세요.', 4200);
    } finally {
      setLocalAiChecking(false);
    }
  };

  const applyCareSelection = (result: CareResult, personalized?: Sermon) => {
    const nextBook = BOOKS.find((item) => item.name === result.topic.book)!;
    const nextRef = reference(nextBook, result.topic.chapter, result.topic.start, result.topic.end);
    setMobileTab('bible');
    setHeartFinderOpen(false);
    setSermonReady(false);
    setCareResult(result);
    setBook(nextBook);
    setChapter(result.topic.chapter);
    setStartVerse(result.topic.start);
    setEndVerse(result.topic.end);
    setCustomSermon(personalized ? { ref: nextRef, sermon: personalized } : null);
  };

  const revealUrgentResult = (result: CareResult) => {
    applyCareSelection(result);
    setIsGenerating(false);
    schedule(() => urgentCareRef.current?.focus(), 0);
  };

  const submitConcern = async (event: FormEvent) => {
    event.preventDefault();
    const text = concern.trim();
    if (!text) return;
    const result = recommendConcern(text);
    const concernBook = BOOKS.find((item) => item.name === result.topic.book)!;
    const concernRef = reference(concernBook, result.topic.chapter, result.topic.start, result.topic.end);
    const bundled = Boolean(CURATED[`${result.topic.book}-${result.topic.chapter}-${result.topic.start}-${result.topic.end}`]?.manuscript);
    setHeartFinderOpen(false);
    stopSpeech();
    localAiAbort.current?.abort();
    const requestId = ++generationRequest.current;
    questionRequest.current += 1;
    setAnswering(false);
    setConcern('');
    setQuestion('');
    setChat([]);
    setGenerationIssue(null);
    if (result.urgent) {
      revealUrgentResult(result);
      return;
    }

    applyCareSelection(result);
    setIsGenerating(true);

    if (localPersonalMode) {
      const controller = new AbortController();
      localAiAbort.current = controller;
      const timeout = schedule(() => controller.abort(), 195_000);
      let reachedServer = false;
      try {
        const response = await fetchLocalGeneration('/sermon', { concern: text, topicId: result.topic.id }, controller.signal);
        reachedServer = true;
        setLocalAiStatus('connected');
        if (!response.ok) throw new Error(`local_ai_${response.status}`);
        const payload: unknown = response.data;
        if (!isLocalAiPayload(payload) || payload.topicId !== result.topic.id
          || !passageSectionsCover(payload.sermon.passageSections, result.topic.start, result.topic.end)
          || !manuscriptCoversPassage(payload.sermon.manuscript, payload.sermon.passageSections, result.topic.start, result.topic.end)) throw new Error('invalid_local_ai_response');
        if (requestId !== generationRequest.current) return;

        if (payload.urgent !== 'none') {
          const urgentResult = payload.urgent === 'self_harm' || payload.urgent === 'both' || payload.urgent === 'harm_to_others' || payload.urgent === 'complex_danger'
            ? { topic: SELF_HARM_TOPIC, urgent: payload.urgent }
            : { topic: VIOLENCE_TOPIC, urgent: payload.urgent };
          revealUrgentResult(urgentResult);
          return;
        }

        applyCareSelection(result, payload.sermon);
        setGenerationIssue(null);
        setIsGenerating(false);
        setSermonReady(true);
        showNotice('이 마음에 맞는 말씀 설교를 준비했어요.', 3000);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      } catch (error) {
        if (requestId !== generationRequest.current) return;
        applyCareSelection(result);
        setIsGenerating(false);
        setSermonReady(bundled);
        if (!bundled) setGenerationIssue(describeGenerationIssue(error, concernRef));
        if (!reachedServer || /_(401|403)$/.test(error instanceof Error ? error.message : String(error))) setLocalAiStatus('offline');
        showNotice('어울리는 말씀은 찾았지만 실제 설교는 완성하지 못했어요. 임시 원고로 대신하지 않을게요.', 4400);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      } finally {
        window.clearTimeout(timeout);
        timers.current.delete(timeout);
        if (localAiAbort.current === controller) localAiAbort.current = null;
      }
    }

    applyCareSelection(result);
    setIsGenerating(false);
    setSermonReady(bundled);
    if (!bundled) setGenerationIssue({ ref: concernRef, kind: 'not-configured', message: '마음에 어울리는 말씀은 찾았어요. 실제 맞춤 설교를 만들려면 휴대폰 앱을 PC의 Codex 말씀 서버와 연결해 주세요.' });
    showNotice(bundled ? `${result.topic.label}에 어울리는 준비된 설교를 열었어요.` : '어울리는 말씀은 찾았고, 실제 설교에는 PC 연결이 필요해요.', 3600);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    const urgent = detectUrgency(text, 'question');
    if (urgent) {
      const result = urgent === 'self_harm' || urgent === 'both' || urgent === 'harm_to_others' || urgent === 'complex_danger'
        ? { topic: SELF_HARM_TOPIC, urgent }
        : { topic: VIOLENCE_TOPIC, urgent };
      stopSpeech();
      localAiAbort.current?.abort();
      generationRequest.current += 1;
      questionRequest.current += 1;
      setQuestion('');
      setAnswering(false);
      revealUrgentResult(result);
      setChat([{ role: 'user', text }, { role: 'guide', text: urgentGuidance(urgent) }]);
      return;
    }
    if (answering) return;
    setChat((current) => [...current, { role: 'user', text }]);
    setQuestion('');
    setAnswering(true);
    const requestId = ++questionRequest.current;
    schedule(() => {
      if (requestId !== questionRequest.current) return;
      setChat((current) => [...current, { role: 'guide', text: answerQuestion(text, sermon, ref) }]);
      setAnswering(false);
    }, 680);
  };

  const localAiLabel = localAiStatus === 'connected'
    ? 'AI 연결됨'
    : localAiStatus === 'checking'
      ? 'AI 확인 중'
      : localPersonalMode
        ? 'AI 다시 연결'
        : 'AI 연결';
  const visibleGenerationIssue = generationIssue?.ref === ref ? generationIssue : null;

  return (
    <main className={`app-shell ${ttsStatus !== 'idle' ? 'mobile-tts-active' : ''}`} style={{ '--reading-scale': fontScale } as React.CSSProperties}>
      <aside className="side-rail">
        <button className="brand-mark" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="처음으로">온</button>
        <nav aria-label="주요 메뉴" className="rail-nav">
          <a className="rail-item active" href="#today" aria-label="오늘의 말씀"><span aria-hidden="true">⌂</span></a>
          <button className="rail-item" type="button" onClick={openPicker} aria-label="성경 찾기"><span aria-hidden="true">▤</span></button>
          <a className="rail-item" href="#reflection" aria-label="묵상하기"><span aria-hidden="true">✎</span></a>
        </nav>
        <button className="profile-dot" type="button" aria-label="내 정보">나</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="wordmark">
            <strong>오늘의 말씀</strong>
            <span>말씀이 오늘의 삶이 되도록</span>
          </div>
          <div className="top-actions">
            <button className={`ai-link-button ${localAiStatus === 'connected' ? 'connected' : ''} ${localAiStatus === 'offline' ? 'offline' : ''}`} type="button" onClick={() => { setLocalAiDraft(localAiConnection); setLocalAiSettingsOpen(true); }}>
              <span aria-hidden="true">{localAiStatus === 'connected' ? '●' : '○'}</span>{localAiLabel}
            </button>
            <button className="quiet-button" type="button" onClick={changeFont}>가<span aria-hidden="true">⁺</span> 읽기 설정</button>
            <button className="primary-button" type="button" onClick={openPicker}>새 말씀 찾기 <span aria-hidden="true">→</span></button>
          </div>
        </header>

        <div className="content-grid">
          <aside className="history-panel" aria-label="추천 말씀">
            <p className="eyebrow">나의 말씀 여정</p>
            <h2>말씀 바로가기</h2>
            <div className="reading-list">
              {QUICK_READINGS.map((reading) => {
                const active = reading.book === book.name && reading.chapter === chapter && reading.start === startVerse && reading.end === endVerse;
                return (
                  <button className={`reading-item ${active ? 'active' : ''}`} key={reading.label} onClick={() => chooseReading(reading)} type="button">
                    <span className="reading-date">{reading.label}</span>
                    <span><strong>{reading.book}</strong><small>{reading.chapter}:{reading.start}–{reading.end}</small></span>
                  </button>
                );
              })}
            </div>
            <button className="all-books-button" type="button" onClick={openPicker}>성경 66권에서 찾기 <span>→</span></button>
            <div className="journey-card">
              <span className="journey-icon" aria-hidden="true">천천히, 함께</span>
              <p><strong>다 이해하지 못해도 괜찮아요</strong></p>
              <p>한 구절을 붙들고 질문하는 것도 좋은 성경 읽기예요.</p>
            </div>
            <div className="copyright-note">
              <strong>성경 본문 전체를 함께 읽어요</strong>
              <span>개인 번역·공개 검증 중인 비공인 PLAY X 성경 본문을 절 번호와 함께 제공합니다. 원 번역자·저장소와 공식 제휴한 앱은 아닙니다.</span>
            </div>
          </aside>

          <article className={`sermon-panel ${isGenerating ? 'is-loading' : ''} ${mobileTab === 'question' ? 'mobile-tab-article-hidden' : ''}`} id="today" aria-busy={isGenerating}>
            {isGenerating && (
              <div className="sermon-loading" role="status"><span className="loading-leaf">온</span><strong>{careResult ? '마음과 말씀을 함께 살피고 있어요…' : '말씀의 앞뒤 맥락을 살피고 있어요…'}</strong><small>잠시만 기다려 주세요.</small></div>
            )}
            <div className={`mobile-tab-panel mobile-bible-panel ${mobileTab === 'bible' ? 'mobile-active' : ''}`} id="mobile-bible-panel">
            <div className="passage-heading">
              <div>
                <p className="eyebrow accent">함께 읽을 말씀 · {book.testament} {book.group}</p>
                <button className="passage-title-button" type="button" onClick={openPicker}><h1>{ref.replace('–', '\u2060–\u2060')}</h1><span aria-hidden="true">⌄</span></button>
                <p className="passage-subtitle">
                  <strong>{generatedSermonAvailable ? 'PC 코덱스가 만든 실제 설교' : curatedSermonAvailable ? '앱에 준비된 전체 설교' : isGenerating ? 'PC 코덱스가 설교를 만드는 중' : 'AI 설교 준비 필요'} · </strong>
                  {completeSermonAvailable ? sermon.summary : isGenerating ? '본문 전체를 먼저 읽는 동안 본문에 맞는 설교 원고를 만들고 있어요.' : visibleGenerationIssue?.message ?? '실제 AI 설교가 완성되기 전에는 임시 원고를 보여주지 않아요.'}
                </p>
              </div>
              <div className="passage-actions">
                <button className={`voice-button ${ttsTarget === 'sermon' && ttsStatus !== 'idle' ? 'active' : ''}`} type="button" onClick={ttsTarget === 'sermon' && ttsStatus === 'playing' ? pauseSpeech : () => startSpeech('sermon')} disabled={isGenerating || !completeSermonAvailable || (ttsTarget === 'sermon' && ttsStatus === 'loading')}>
                  {isGenerating ? '설교 만드는 중…' : !completeSermonAvailable ? '설교 준비 필요' : ttsTarget === 'sermon' && ttsStatus === 'loading' ? '음성 준비 중…' : ttsTarget === 'sermon' && ttsStatus === 'playing' ? 'Ⅱ 설교 멈춤' : ttsTarget === 'sermon' && ttsStatus === 'paused' ? '▶ 설교 계속 듣기' : '▶ 목사님처럼 설교 듣기'}
                </button>
                {ttsStatus !== 'idle' && <button className="voice-stop" type="button" onClick={stopSpeech}>중지</button>}
                <button className={`icon-button ${saved ? 'saved' : ''}`} onClick={toggleSaved} type="button" aria-label={saved ? '말씀 저장 해제' : '말씀 저장'}>{saved ? '♥' : '♡'}</button>
                <small className="voice-note">웹·안드로이드 기기 한국어 음성 · 별도 TTS API 이용료 없음</small>
                <span className="sr-only" aria-live="polite">{ttsStatus === 'loading' ? '한국어 음성을 준비하고 있습니다.' : ttsStatus === 'playing' ? `${ttsTarget === 'scripture' ? '본문' : '설교'}을 읽는 중입니다.` : ttsStatus === 'paused' ? '음성 읽기를 잠시 멈췄습니다.' : ''}</span>
              </div>
            </div>

            <section className="scripture-reader" id="scripture" aria-labelledby="scripture-title" aria-busy={passageStatus === 'loading'}>
              <header className="scripture-reader-heading">
                <div>
                  <p className="eyebrow accent">말씀을 먼저 천천히 읽어요</p>
                  <h2 id="scripture-title">{ref} 본문 전체</h2>
                  <p>설교보다 먼저 선택한 말씀을 처음 절부터 마지막 절까지 빠짐없이 보여드려요.</p>
                </div>
                <div className="scripture-actions">
                  <button type="button" onClick={ttsTarget === 'scripture' && ttsStatus === 'playing' ? pauseSpeech : () => startSpeech('scripture')} disabled={passageStatus !== 'ready' || (ttsTarget === 'scripture' && ttsStatus === 'loading')}>
                    {ttsTarget === 'scripture' && ttsStatus === 'loading' ? '음성 준비 중…' : ttsTarget === 'scripture' && ttsStatus === 'playing' ? 'Ⅱ 잠시 멈춤' : ttsTarget === 'scripture' && ttsStatus === 'paused' ? '▶ 계속 듣기' : '▶ 본문 듣기'}
                  </button>
                  {ttsTarget === 'scripture' && ttsStatus !== 'idle' && <button className="quiet" type="button" onClick={stopSpeech}>중지</button>}
                </div>
              </header>

              {passageStatus === 'loading' && <div className="scripture-state" role="status"><span className="loading-leaf">온</span><p>본문 전체를 불러오고 있어요…</p></div>}
              {passageStatus === 'error' && (
                <div className="scripture-state error" role="alert">
                  <p>본문을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
                  <button type="button" onClick={() => setPassageReload((value) => value + 1)}>본문 다시 불러오기</button>
                </div>
              )}
              {passageStatus === 'ready' && (
                <div className="scripture-verses">
                  {passageVerses.map((verse) => (
                    <p key={verse.number} id={`verse-${verse.number}`}><sup>{verse.number}</sup><span>{verse.text}</span></p>
                  ))}
                </div>
              )}

              <footer className="scripture-source">
                <span>PLAY X 번역(플레이엑스) · 번역: 김무송 · CC BY 4.0 · 개인 번역·공개 검증 중인 비공인 번역 · 공식 제휴 아님 · 표준 66권 구조로 분할, 비표준 원본 키 13개 제외·본문 문구 미변경</span>
                <span className="scripture-source-links"><a href="https://github.com/PLAYX1/playx-bible/tree/422073daf8d0dbe56ce8a65bbfe236aa8ddd933a" target="_blank" rel="noreferrer">고정 원본 보기</a><a href="https://creativecommons.org/licenses/by/4.0/deed.ko" target="_blank" rel="noreferrer">CC BY 4.0 보기</a></span>
              </footer>
            </section>
            </div>

            <div className={`mobile-tab-panel mobile-heart-panel ${mobileTab === 'heart' ? 'mobile-active' : ''}`} id="mobile-heart-panel">
            <button
              className={`heart-finder-tab ${heartFinderOpen ? 'active' : ''}`}
              type="button"
              aria-expanded={heartFinderOpen}
              aria-controls="heart-finder-panel"
              onClick={() => setHeartFinderOpen((open) => !open)}
            >
              <span aria-hidden="true">♡</span>
              <strong>{careResult ? '다른 마음에 맞는 말씀 찾기' : '마음에 맞는 말씀 찾기'}</strong>
              <small>{heartFinderOpen ? '닫기 －' : '열기 ＋'}</small>
            </button>

            {heartFinderOpen && <section className="heart-finder" id="heart-finder-panel" aria-labelledby="heart-finder-title">
              <div className="heart-finder-intro">
                <p className="eyebrow accent">마음에 맞는 말씀 찾기</p>
                <h2 id="heart-finder-title">요즘 무엇이 가장 힘드세요?</h2>
                <p>정리해서 말하지 않아도 괜찮아요. 지금의 마음과 가까운 성경 단락을 찾고, 이해하기 쉬운 설교로 함께 풀어드려요.</p>
              </div>
              <form className="heart-finder-form" onSubmit={submitConcern}>
                <textarea value={concern} onChange={(event) => setConcern(event.target.value)} maxLength={800} rows={3} placeholder="예: 회사에서 계속 실수해서 자신감이 없어지고, 내 앞날이 너무 불안해요." aria-label="요즘 힘든 점" />
                <div><small>입력한 내용은 이 사이트에 저장하지 않아요.</small><button type="submit" disabled={!concern.trim()}>이 마음에 맞는 말씀 찾기 <span>→</span></button></div>
              </form>
            </section>}
            </div>

            <div className={`mobile-tab-panel mobile-care-result-panel ${careResult && (mobileTab === 'bible' || mobileTab === 'heart') ? 'mobile-active' : ''}`}>
              {careResult && (
                <div className="care-result care-result-standalone">
                  {careResult.urgent === 'self_harm' && (
                    <div className="urgent-care" role="alert" tabIndex={-1} ref={urgentCareRef}>
                      <strong>지금은 말씀 추천보다 안전이 먼저예요</strong>
                      <p>이미 다쳤거나 약을 복용했거나 실행 직전이라면 119·112 또는 가까운 응급실에 먼저 연락하세요. 혼자 있지 말고 위험한 물건·장소에서 떨어진 뒤, 24시간 자살예방 상담전화 109에도 도움을 요청해 주세요. 말씀은 긴급한 도움을 대신하지 않습니다.</p>
                      <div><a href="tel:119">구급 119</a><a href="tel:112">경찰 112</a><a href="tel:109">자살예방 상담 109</a></div>
                    </div>
                  )}
                  {careResult.urgent === 'violence' && (
                    <div className="urgent-care" role="alert" tabIndex={-1} ref={urgentCareRef}>
                      <strong>폭력보다 당신의 안전이 먼저예요</strong>
                      <p>가해자와 혼자 대면하거나 설득하려 하지 말고 가능한 안전한 곳으로 이동하세요. 당장 다쳤거나 위험하면 119·112에 먼저 연락하세요. 용서나 교회 안의 해결보다 피해자의 안전이 먼저입니다.</p>
                      <div><a href="tel:119">구급 119</a><a href="tel:112">경찰 112</a><a href="tel:1366">여성긴급전화 1366</a></div>
                    </div>
                  )}
                  {careResult.urgent === 'both' && (
                    <div className="urgent-care" role="alert" tabIndex={-1} ref={urgentCareRef}>
                      <strong>지금은 생명과 안전이 가장 먼저예요</strong>
                      <p>이미 다쳤거나 약을 복용했거나 실행 직전이라면 119·112 또는 가까운 응급실에 먼저 연락하세요. 혼자 있지 말고 가해자와 떨어진 안전한 곳으로 이동한 뒤 109와 1366의 도움도 받을 수 있어요.</p>
                      <div><a href="tel:119">구급 119</a><a href="tel:112">경찰 112</a><a href="tel:109">자살예방 상담 109</a><a href="tel:1366">여성긴급전화 1366</a></div>
                    </div>
                  )}
                  {careResult.urgent === 'harm_to_others' && (
                    <div className="urgent-care" role="alert" tabIndex={-1} ref={urgentCareRef}>
                      <strong>다른 사람과 거리를 두고 즉시 도움을 요청하세요</strong>
                      <p>칼이나 위험한 물건을 내려놓고 상대에게 다가가지 마세요. 운전하지 말고 112·119에 지금 상황을 알린 뒤 가까운 응급실이나 믿을 만한 사람의 도움을 받아 혼자 있지 마세요.</p>
                      <div><a href="tel:112">경찰 112</a><a href="tel:119">구급 119</a></div>
                    </div>
                  )}
                  {careResult.urgent === 'complex_danger' && (
                    <div className="urgent-care" role="alert" tabIndex={-1} ref={urgentCareRef}>
                      <strong>여러 생명과 안전을 위해 즉시 거리를 두세요</strong>
                      <p>위험한 물건을 내려놓고 상대와 떨어지며, 가해자가 있다면 맞서지 말고 안전한 곳으로 이동하세요. 112·119 또는 가까운 응급실에 먼저 연락하고 혼자 있지 마세요.</p>
                      <div><a href="tel:112">경찰 112</a><a href="tel:119">구급 119</a><a href="tel:109">자살예방 상담 109</a><a href="tel:1366">여성긴급전화 1366</a></div>
                    </div>
                  )}
                  <div className="care-passage" role={careResult.urgent ? undefined : 'status'}>
                    <span>{careResult.topic.label}에 추천한 말씀</span>
                    <strong>{careResult.topic.book} {careResult.topic.chapter}장 {verseSpan(careResult.topic.start, careResult.topic.end)}</strong>
                    <p>{careResult.topic.reason}</p>
                    <small>{careResult.urgent ? '긴급 도움에 먼저 연결된 뒤, 원한다면 아래 말씀을 천천히 읽어도 좋아요.' : '바로 아래에서 이 말씀의 배경부터 오늘의 적용·결단·기도까지 이어서 풀어드려요.'}</small>
                  </div>
                </div>
              )}
            </div>

            <div className={`mobile-tab-panel mobile-sermon-panel ${mobileTab === 'sermon' ? 'mobile-active' : ''}`} id="mobile-sermon-panel">
            {!completeSermonAvailable ? (
              <section className="sermon-unavailable" role="status" aria-live="polite">
                <span className={`sermon-unavailable-mark ${isGenerating ? 'working' : ''}`} aria-hidden="true">온</span>
                <p className="eyebrow accent">{ref} · 실제 AI 설교</p>
                <h1>{isGenerating ? 'PC 코덱스가 본문을 읽고 설교를 만들고 있어요' : '이 본문의 실제 설교는 아직 완성되지 않았어요'}</h1>
                <p>{isGenerating ? '본문의 흐름을 나누고, 각 구간의 뜻을 오늘의 삶과 연결한 한 편의 설교 원고를 작성 중이에요. 보통 1–3분 정도 걸릴 수 있어요.' : visibleGenerationIssue?.message ?? '본문과 상관없는 임시 글은 설교처럼 보여주지 않아요. PC 코덱스 연결 뒤 이 본문을 다시 선택하면 실제 설교를 만들어요.'}</p>
                <div className="sermon-connection-state">
                  <span>PC 연결</span>
                  <strong>{localAiStatus === 'connected' ? '정상 연결됨' : localAiStatus === 'checking' ? '확인 중' : localPersonalMode ? '연결 안 됨' : '설정 필요'}</strong>
                </div>
                <div className="sermon-unavailable-actions">
                  {localPersonalMode && <button className="primary-button" type="button" disabled={isGenerating} onClick={() => void prepareReading(book, chapter, startVerse, endVerse)}>{isGenerating ? '설교 만드는 중…' : '이 본문 설교 다시 만들기'}</button>}
                  <button className="quiet-button" type="button" onClick={() => { setLocalAiDraft(localAiConnection); setLocalAiSettingsOpen(true); }}>AI 연결 확인</button>
                </div>
                <small>성경 본문 전체는 성경 탭에서 언제든 먼저 읽고 들을 수 있어요.</small>
              </section>
            ) : (
            <>
            <header className="mobile-sermon-header">
              <p className="eyebrow accent">{ref} · 구간별 강해와 설교</p>
              <h1>{sermon.title}</h1>
              <p>{sermon.summary}</p>
              <div className="mobile-sermon-actions">
                <button className={`voice-button ${ttsTarget === 'sermon' && ttsStatus !== 'idle' ? 'active' : ''}`} type="button" onClick={ttsTarget === 'sermon' && ttsStatus === 'playing' ? pauseSpeech : () => startSpeech('sermon')} disabled={isGenerating || (ttsTarget === 'sermon' && ttsStatus === 'loading')}>
                  {ttsTarget === 'sermon' && ttsStatus === 'loading' ? '음성 준비 중…' : ttsTarget === 'sermon' && ttsStatus === 'playing' ? 'Ⅱ 설교 멈춤' : ttsTarget === 'sermon' && ttsStatus === 'paused' ? '▶ 설교 계속 듣기' : '▶ 목사님처럼 설교 듣기'}
                </button>
                {ttsTarget === 'sermon' && ttsStatus !== 'idle' && <button className="voice-stop" type="button" onClick={stopSpeech}>중지</button>}
              </div>
            </header>
            <section className="passage-exposition" id="sermon-exposition" aria-labelledby="exposition-title">
              <div className="section-title-row">
                <span className="section-number">강해</span>
                <div><p className="eyebrow">본문을 이렇게 나누어 읽어요</p><h2 id="exposition-title">어디서부터 어디까지, 어떤 말씀인가요?</h2></div>
              </div>
              <p className="exposition-intro">절 수를 똑같이 잘라 나눈 것이 아니라 이야기·논리·장면이 바뀌는 흐름을 따라 살펴봅니다.</p>
              <div className="exposition-list">
                {sermon.passageSections.map((section) => (
                  <article key={`${section.start}-${section.end}`}>
                    <span>{verseSpan(section.start, section.end)}</span>
                    <div><h3>{section.title}</h3><p>{section.explanation}</p></div>
                  </article>
                ))}
              </div>
            </section>

            <section className="sermon-manuscript" aria-labelledby="sermon-manuscript-title">
              <header>
                <div><p className="eyebrow accent">실제 설교 원고 · 약 {sermon.manuscript.estimatedMinutes}분</p><h2 id="sermon-manuscript-title">{sermon.title}</h2></div>
                <button className={`voice-button ${ttsTarget === 'sermon' && ttsStatus !== 'idle' ? 'active' : ''}`} type="button" onClick={ttsTarget === 'sermon' && ttsStatus === 'playing' ? pauseSpeech : () => startSpeech('sermon')} disabled={isGenerating || (ttsTarget === 'sermon' && ttsStatus === 'loading')}>
                  {ttsTarget === 'sermon' && ttsStatus === 'loading' ? '음성 준비 중…' : ttsTarget === 'sermon' && ttsStatus === 'playing' ? 'Ⅱ 설교 멈춤' : ttsTarget === 'sermon' && ttsStatus === 'paused' ? '▶ 설교 계속 듣기' : '▶ 목사님처럼 설교 듣기'}
                </button>
              </header>
              <div className="manuscript-introduction">
                {sermon.manuscript.introduction.map((paragraph, index) => <p key={`intro-${index}`}>{paragraph}</p>)}
              </div>
              <aside className="manuscript-context"><strong>본문의 배경</strong><p>{sermon.context}</p></aside>
              <div className="manuscript-movements">
                {sermon.manuscript.sections.map((section, index) => (
                  <article key={`${section.start}-${section.end}`}>
                    <header><span>{verseSpan(section.start, section.end)}</span><small>{index + 1} / {sermon.manuscript.sections.length}</small><h3>{section.heading}</h3></header>
                    {passageStatus === 'ready' && (
                      <blockquote className="manuscript-scripture">
                        <strong>{verseSpan(section.start, section.end)} 실제 본문</strong>
                        {passageVerses.filter((verse) => verse.number >= section.start && verse.number <= section.end).map((verse) => (
                          <p key={`${section.start}-verse-${verse.number}`}><sup>{verse.number}</sup><span>{verse.text}</span></p>
                        ))}
                      </blockquote>
                    )}
                    {section.paragraphs.map((paragraph, paragraphIndex) => <p key={`${section.start}-p-${paragraphIndex}`}>{paragraph}</p>)}
                    <p className="manuscript-bridge">{section.bridgeToNext}</p>
                  </article>
                ))}
              </div>
              <div className="manuscript-gospel"><p className="eyebrow">은혜와 복음으로 이어 보기</p>{sermon.manuscript.gospelConnection.map((paragraph, index) => <p key={`gospel-${index}`}>{paragraph}</p>)}</div>
              <div className="manuscript-conclusion"><p className="eyebrow">말씀을 오늘의 삶으로</p>{sermon.manuscript.conclusion.map((paragraph, index) => <p key={`conclusion-${index}`}>{paragraph}</p>)}</div>
              <blockquote className="manuscript-prayer"><span>함께 드리는 기도</span>{sermon.manuscript.closingPrayer}</blockquote>
            </section>

            <details className="sermon-study-details">
              <summary>본문 구조·관련 말씀·적용을 더 깊이 보기</summary>
              <div className="sermon-study-details-body">

            <section className="focus-card" aria-labelledby="focus-title">
              <div className="pastor-avatar" aria-hidden="true">온</div>
              <div>
                <p className="speaker-label">온유 AI 말씀 길잡이 · 설교형 해설</p>
                <h2 id="focus-title">{sermon.title}</h2>
                <p>{sermon.opening}</p>
              </div>
            </section>

            <section className="sermon-section first">
              <div className="section-title-row">
                <span className="section-number">01</span>
                <div><p className="eyebrow">본문 속으로 들어가기</p><h2>앞뒤 맥락부터 천천히 살펴봐요</h2></div>
              </div>
              <p className="book-context">{sermon.context}</p>
              <div className="point-list">
                {sermon.points.map((point, index) => (
                  <div className="sermon-point" key={point.title}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div><h3>{point.title}</h3><p>{point.body}</p></div>
                  </div>
                ))}
              </div>
              <div className="sermon-illustration">
                <span aria-hidden="true">한 장면</span>
                <div><p className="eyebrow">마음에 오래 남도록</p><p>{sermon.illustration}</p></div>
              </div>
            </section>

            <section className="cross-reference-section">
              <div className="section-title-row">
                <span className="section-number">02</span>
                <div><p className="eyebrow">성경 전체로 연결하기</p><h2>다른 말씀과 함께 읽으면 더 또렷해져요</h2></div>
              </div>
              <div className="cross-reference-list">
                {sermon.crossReferences.map((item) => (
                  <div key={item.reference}><strong>{item.reference}</strong><p>{item.connection}</p></div>
                ))}
              </div>
            </section>

            <section className="sermon-section korean-life">
              <div className="section-title-row">
                <span className="section-number">03</span>
                <div><p className="eyebrow">2026년 한국에서라면</p><h2>말씀을 오늘의 선택에 연결해요</h2></div>
              </div>
              <div className="application-list">
                {sermon.applications.map((item, index) => (
                  <div className="application-item" key={item}><span>{index + 1}</span><p>{item}</p></div>
                ))}
              </div>
            </section>

            <section className="context-check">
              <span className="context-icon" aria-hidden="true">!</span>
              <div><p className="eyebrow">오해하지 않기</p><h2>이렇게 사용하지는 마세요</h2><p>{sermon.caution}</p></div>
            </section>

            <section className="sermon-section reflection-section" id="reflection">
              <div className="section-title-row">
                <span className="section-number">04</span>
                <div><p className="eyebrow">잠시 멈추어 묵상하기</p><h2>정답보다 솔직한 마음으로</h2></div>
              </div>
              <ol className="reflection-list">
                {sermon.questions.map((item) => <li key={item}>{item}</li>)}
              </ol>
            </section>

            <section className="decision-card">
              <span className="decision-label">오늘의 결단</span>
              <p>{sermon.decision}</p>
              <small>크게 약속하기보다 오늘 할 수 있는 한 가지를 선택해 보세요.</small>
            </section>

            <section className="prayer-card">
              <p className="eyebrow">오늘의 짧은 기도</p>
              <blockquote>{sermon.prayer}</blockquote>
              <button type="button" onClick={() => { navigator.clipboard?.writeText(sermon.prayer); showNotice('기도문을 복사했어요.', 1800); }}>기도문 복사</button>
            </section>
              </div>
            </details>
            </>
            )}

            <details className="safety-details">
              <summary>AI 말씀 안내를 사용할 때 꼭 알아두세요</summary>
              <div>
                <p>이 서비스는 성경 이해를 돕는 해설 도구이며 하나님의 음성이나 뜻을 확정하지 않습니다. 교단과 신앙 전통에 따라 해석이 다를 수 있고, 목회자·의료·법률 등 전문 상담을 대신하지 않아요.</p>
                <p>폭력, 성적 피해, 재정 착취, 협박이 의심되면 먼저 안전을 확보하고 외부 전문기관이나 수사기관의 도움을 받으세요. 이미 다쳤거나 자신·다른 사람을 곧 해칠 위험이 있다면 112·119 또는 가까운 응급실에 먼저 연락하세요. 자살 위기 상담은 109, 여성폭력 피해 상담은 1366에서 24시간 받을 수 있습니다.</p>
              </div>
            </details>
            </div>
          </article>

          <aside className={`companion-panel mobile-question-panel ${mobileTab === 'question' ? 'mobile-active' : ''}`} id="mobile-question-panel" aria-label="AI 말씀 질문">
            <p className="eyebrow">말씀 곁에 두기</p>
            <h2>오늘의 한 문장</h2>
            <blockquote>“{sermon.summary}”</blockquote>
            <div className="divider" />
            <h3>온유에게 말씀 물어보기</h3>
            <p>어려운 표현이나 오늘의 적용을 편하게 질문해 보세요.</p>
            <div className="quick-questions">
              {['이 말씀의 맥락은?', '오늘 어떻게 실천해요?', '짧게 기도해 줘'].map((item) => (
                <button key={item} type="button" onClick={() => setQuestion(item)} disabled={isGenerating}>{item}</button>
              ))}
            </div>
            {chat.length > 0 && (
              <div className="chat-log" aria-live="polite">
                {chat.map((message, index) => <p className={message.role} key={`${message.role}-${index}`}><strong>{message.role === 'guide' ? '온유' : '나'}</strong>{message.text}</p>)}
                {answering && <p className="guide thinking"><strong>온유</strong>본문을 다시 살펴보는 중…</p>}
              </div>
            )}
            <form className="question-box" onSubmit={submitQuestion}>
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="예: 하나님을 경외한다는 게 무서워하라는 뜻인가요?" aria-label="말씀 질문" rows={3} />
              <button type="submit" aria-label="질문 보내기" disabled={!question.trim() || ((isGenerating || answering) && !detectUrgency(question, 'question'))}>↑</button>
            </form>
            <p className="care-note">AI가 예언·계시를 단정하거나 중대한 결정을 강요해서는 안 됩니다. 중요한 판단은 신뢰할 수 있는 목회자와 관련 전문가에게도 상의하세요.</p>
          </aside>
        </div>
      </section>

      {ttsStatus !== 'idle' && (
        <div className="mobile-audio-bar" role="status" aria-label={`${ttsTarget === 'scripture' ? '본문' : '설교'} 음성 재생 상태`}>
          <span><small>{ttsTarget === 'scripture' ? '본문 듣기' : '설교 듣기'}</small><strong>{ttsStatus === 'loading' ? '음성을 준비하고 있어요' : ttsStatus === 'playing' ? '읽는 중' : '잠시 멈춤'}</strong></span>
          <button type="button" onClick={ttsStatus === 'playing' ? pauseSpeech : () => startSpeech(ttsTarget)} disabled={ttsStatus === 'loading'} aria-label={ttsStatus === 'playing' ? '음성 일시정지' : '음성 계속 듣기'}>{ttsStatus === 'playing' ? 'Ⅱ' : '▶'}</button>
          <button type="button" onClick={stopSpeech} aria-label="음성 중지">■</button>
        </div>
      )}

      <nav className="mobile-bottom-nav" role="tablist" aria-label="주요 화면">
        <button id="mobile-tab-bible" className={mobileTab === 'bible' ? 'active' : ''} type="button" role="tab" aria-selected={mobileTab === 'bible'} aria-controls="mobile-bible-panel" onClick={() => selectMobileTab('bible')}>
          <span aria-hidden="true">▤</span><strong>성경</strong>
        </button>
        <button id="mobile-tab-sermon" className={mobileTab === 'sermon' ? 'active' : ''} type="button" role="tab" aria-selected={mobileTab === 'sermon'} aria-controls="mobile-sermon-panel" onClick={() => selectMobileTab('sermon')}>
          <span aria-hidden="true">♨</span><strong>설교</strong>{completeSermonAvailable && (sermonReady || curatedSermonAvailable) && !isGenerating && <small className="mobile-tab-badge">준비</small>}
        </button>
        <button id="mobile-tab-heart" className={mobileTab === 'heart' ? 'active' : ''} type="button" role="tab" aria-selected={mobileTab === 'heart'} aria-controls="mobile-heart-panel" onClick={() => selectMobileTab('heart')}>
          <span aria-hidden="true">♡</span><strong>마음</strong>
        </button>
        <button id="mobile-tab-question" className={mobileTab === 'question' ? 'active' : ''} type="button" role="tab" aria-selected={mobileTab === 'question'} aria-controls="mobile-question-panel" onClick={() => selectMobileTab('question')}>
          <span aria-hidden="true">◌</span><strong>질문</strong>{chat.length > 0 && <small className="mobile-tab-dot" aria-label="대화 있음" />}
        </button>
      </nav>

      {pickerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPickerOpen(false); }}>
          <section className="passage-picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
            <header>
              <div><p className="eyebrow accent">창세기부터 요한계시록까지</p><h2 id="picker-title">어느 말씀을 함께 읽을까요?</h2></div>
              <button type="button" onClick={() => setPickerOpen(false)} aria-label="닫기">×</button>
            </header>
            <div className="picker-body">
              <div className="book-browser">
                <div className="picker-tools">
                  <div className="testament-tabs" role="tablist" aria-label="성경 구분">
                    {(['전체', '구약', '신약'] as const).map((item) => <button className={testament === item ? 'active' : ''} role="tab" aria-selected={testament === item} onClick={() => setTestament(item)} key={item} type="button">{item}</button>)}
                  </div>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="성경 이름 검색" aria-label="성경 이름 검색" />
                </div>
                <div className="book-grid">
                  {filteredBooks.map((item) => (
                    <button className={draftBook.name === item.name ? 'active' : ''} onClick={() => {
                      const firstUnit = getPassageUnits(item.name, 1)[0];
                      setDraftBook(item);
                      setDraftChapter(1);
                      setDraftStart(firstUnit.start);
                      setDraftEnd(firstUnit.end);
                    }} type="button" key={item.name}>
                      <strong>{item.name}</strong><small>{item.chapters}장 · {item.group}</small>
                    </button>
                  ))}
                </div>
              </div>
              <aside className="range-panel">
                <p className="eyebrow">선택한 성경</p>
                <h3>{draftBook.name}</h3>
                <p>{draftBook.theme}</p>
                <label>장<select value={draftChapter} onChange={(event) => {
                  const nextChapter = Number(event.target.value);
                  const firstUnit = getPassageUnits(draftBook.name, nextChapter)[0];
                  setDraftChapter(nextChapter);
                  setDraftStart(firstUnit.start);
                  setDraftEnd(firstUnit.end);
                }}>{Array.from({ length: draftBook.chapters }, (_, i) => i + 1).map((item) => <option key={item} value={item}>{item}장</option>)}</select></label>
                <div className="chapter-limit" role="status">
                  <span>이 장의 마지막 절</span>
                  <strong>{draftVerseLimit}절까지</strong>
                </div>
                <button className={`whole-chapter-button ${draftStart === 1 && draftEnd === draftVerseLimit ? 'active' : ''}`} type="button" onClick={() => { setDraftStart(1); setDraftEnd(draftVerseLimit); }}>
                  <span>한 장 전체를 설교로 듣기</span><strong>1–{draftVerseLimit}절 전체</strong>
                </button>
                <div className="passage-unit-picker">
                  <div className="range-label"><strong>문맥이 이어지는 추천 단락</strong><span>먼저 단락 하나를 골라 보세요</span></div>
                  <div className="passage-unit-list" role="group" aria-label={`${draftBook.name} ${draftChapter}장의 추천 말씀 단락`}>
                    {draftUnits.map((unit, index) => {
                      const active = unit.start === draftStart && unit.end === draftEnd;
                      const rangeText = unit.start === unit.end ? `${unit.start}절` : `${unit.start}–${unit.end}절`;
                      return (
                        <button className={active ? 'active' : ''} type="button" aria-pressed={active} key={`${unit.start}-${unit.end}`} onClick={() => { setDraftStart(unit.start); setDraftEnd(unit.end); }}>
                          <span>단락 {index + 1}</span><strong>{rangeText}</strong>
                        </button>
                      );
                    })}
                  </div>
                  <p>단락 구분은 앞뒤 문맥을 따라 읽도록 돕는 추천이에요. 번역본에 따라 조금 다를 수 있습니다.</p>
                </div>
                <div className="manual-range-title"><strong>직접 범위 바꾸기</strong><span>원하는 절만 따로 고를 수도 있어요</span></div>
                <div className="verse-range">
                  <label>시작 절<select value={draftStart} onChange={(event) => { const value = Number(event.target.value); setDraftStart(value); if (value > draftEnd) setDraftEnd(value); }}>{Array.from({ length: draftVerseLimit }, (_, index) => index + 1).map((verse) => <option value={verse} key={verse}>{verse}절</option>)}</select></label>
                  <span>–</span>
                  <label>마지막 절<select value={draftEnd} onChange={(event) => setDraftEnd(Number(event.target.value))}>{Array.from({ length: draftVerseLimit - draftStart + 1 }, (_, index) => draftStart + index).map((verse) => <option value={verse} key={verse}>{verse}절</option>)}</select></label>
                </div>
                <div className="selected-reference">{reference(draftBook, draftChapter, draftStart, draftEnd)}</div>
                <p className="picker-note">선택한 범위의 본문 전체를 먼저 보여드리고, 문맥에 맞는 구간별 강해와 설교를 이어서 제공합니다.</p>
              </aside>
            </div>
            <footer><button className="quiet-button" type="button" onClick={() => setPickerOpen(false)}>취소</button><button className="primary-button wide" type="button" onClick={generate}>이 말씀 쉽게 풀어보기 <span>→</span></button></footer>
          </section>
        </div>
      )}

      {localAiSettingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setLocalAiSettingsOpen(false); }}>
          <section className="ai-connection-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-connection-title">
            <header>
              <div><p className="eyebrow accent">내 PC의 Codex와 연결</p><h2 id="ai-connection-title">실제 긴 AI 설교 연결</h2></div>
              <button type="button" onClick={() => setLocalAiSettingsOpen(false)} aria-label="닫기">×</button>
            </header>
            <p>같은 와이파이에 있는 내 컴퓨터가 선택한 본문을 읽고, 실제 예배처럼 이어지는 설교 원고를 만들어 앱으로 보내 줍니다. 별도 API 키는 사용하지 않아요.</p>
            <label>PC 주소<input value={localAiDraft.baseUrl} onChange={(event) => setLocalAiDraft((current) => ({ ...current, baseUrl: event.target.value }))} inputMode="url" placeholder="예: http://192.168.0.10:4317" autoCapitalize="none" autoCorrect="off" /></label>
            <label>연결 코드<input value={localAiDraft.token} onChange={(event) => setLocalAiDraft((current) => ({ ...current, token: event.target.value }))} type="password" placeholder="PC 화면의 연결 코드" autoCapitalize="none" autoCorrect="off" /></label>
            <small>새 설교를 만들 때만 PC가 켜져 있으면 됩니다. 완성된 설교는 앱에 저장해 다시 들을 수 있어요.</small>
            <footer><button className="quiet-button" type="button" onClick={() => setLocalAiSettingsOpen(false)}>취소</button><button className="primary-button" type="button" onClick={connectLocalAi} disabled={localAiChecking}>{localAiChecking ? '연결 확인 중…' : '연결하고 사용하기'}</button></footer>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
