'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type BookGroup = '율법서' | '역사서' | '시가서' | '예언서' | '복음서' | '사도행전' | '서신서' | '요한계시록';
type Book = { name: string; short: string; chapters: number; testament: '구약' | '신약'; group: BookGroup; theme: string };
type Sermon = {
  title: string;
  summary: string;
  opening: string;
  context: string;
  points: { title: string; body: string }[];
  illustration: string;
  crossReferences: { reference: string; connection: string }[];
  applications: string[];
  caution: string;
  questions: string[];
  decision: string;
  prayer: string;
};
type ChatMessage = { role: 'user' | 'guide'; text: string };

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
  '잠언-1': {
    title: '많이 아는 것보다 잘 듣는 것에서 시작됩니다',
    summary: '하나님을 삶의 기준으로 모시고 기꺼이 배우려는 태도가 참된 지혜의 출발점입니다.',
    opening: '요즘은 휴대폰만 열면 몇 초 안에 답을 얻을 수 있어요. 그런데 답을 빨리 찾는 것과 삶을 바르게 선택하는 것은 같은 일이 아닙니다. 오늘 잠언은 “얼마나 많이 아느냐”보다 “누구의 말을 듣고 어떤 기준으로 사느냐”를 먼저 묻습니다.',
    context: '잠언의 첫머리는 이 책이 단순한 성공 비법이나 좋은 문장 모음이 아니라, 일상에서 옳고 그름을 분별하고 성숙하게 선택하도록 훈련하는 말씀임을 알려 줍니다.',
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
  '시편-23': {
    title: '문제가 사라지기 전에 곁을 발견하는 믿음',
    summary: '시편 23편의 평안은 위험이 없어서가 아니라, 어두운 길에서도 하나님이 함께하신다는 신뢰에서 옵니다.',
    context: '목자와 양의 이미지는 돌봄, 인도, 보호를 보여 줍니다. 시인은 좋은 풀밭만 말하지 않고 깊은 어둠의 골짜기도 함께 말해요.',
  },
  '마태복음-6': {
    title: '걱정을 꾸짖기보다 오늘을 다시 맡기는 연습',
    summary: '예수님은 현실의 필요를 무시하라고 하지 않고, 걱정이 삶의 주인이 되지 않도록 하나님의 돌보심을 바라보게 하십니다.',
    context: '이 말씀은 하루 벌어 하루 살던 사람들에게 주어진 산상설교의 일부입니다. 가난한 이에게 “걱정하지 마”라고 가볍게 말하는 문장이 아니에요.',
  },
  '요한복음-3': {
    title: '정죄보다 먼저 우리에게 다가온 사랑',
    summary: '하나님의 사랑은 멀리서 평가하는 사랑이 아니라, 세상을 살리기 위해 자신을 내어 주신 사랑입니다.',
    context: '밤에 예수님을 찾아온 니고데모와의 대화에서 믿음, 새로 태어남, 하나님의 사랑이 이어집니다. 한 구절만 떼기보다 이 대화 전체를 함께 보세요.',
  },
  '로마서-8': {
    title: '끊을 수 없는 사랑 안에서 견디는 오늘',
    summary: '성령께서 우리의 연약함을 도우시며, 어떤 현실도 그리스도 안에 있는 하나님의 사랑에서 우리를 끊을 수 없습니다.',
    context: '바울은 고난이 없다고 말하지 않습니다. 탄식하는 피조세계와 연약한 사람들의 현실 한가운데서 소망을 말해요.',
  },
  '요한계시록-21': {
    title: '하나님이 눈물을 닦으시는 새 창조',
    summary: '성경의 마지막 소망은 세상을 버리고 도망가는 것이 아니라, 하나님이 만물을 새롭게 하시고 우리와 함께 사시는 것입니다.',
    context: '폭력적인 제국 아래서 버티던 교회가 들은 결말입니다. 악이 영원하지 않으며, 죽음과 눈물의 권세가 끝난다는 약속이에요.',
  },
};

const DEFAULT_APPLICATIONS = [
  '단체 채팅방이나 짧은 영상에서 자극적인 정보를 보았을 때 바로 공유하지 말고, 사실인지와 누군가에게 해가 되지 않는지를 먼저 살펴봅니다.',
  '입시·취업·이직·집·투자·AI 활용을 결정할 때 속도와 이익만 보지 않고 정직, 공정, 이웃에게 미칠 영향도 함께 생각합니다.',
  '가정·직장·교회에서 누군가의 조언을 듣되, 부당한 요구까지 신앙의 이름으로 따르지 말고 필요한 경계를 세웁니다.',
];

function makeSermon(book: Book, chapter: number): Sermon {
  const guide = GROUP_GUIDE[book.group];
  const curated = CURATED[`${book.name}-${chapter}`];
  const base: Sermon = {
    title: `${book.name} ${chapter}장을 오늘의 삶으로 읽는 법`,
    summary: `${book.name}의 중심 주제인 ‘${book.theme}’을 기억하며, 이 장이 하나님과 이웃을 대하는 우리의 방향을 어떻게 다듬는지 살펴봅니다.`,
    opening: `하루를 살다 보면 “이럴 때 믿는 사람은 어떻게 해야 할까?” 싶은 순간을 만납니다. ${book.name} ${chapter}장은 오래전 사람들에게 주어진 말씀이지만, ‘${book.theme}’이라는 큰 흐름을 통해 오늘 우리의 관계와 선택도 비춰 줍니다.`,
    context: guide.context,
    points: [
      { title: '먼저 큰 이야기 안에서 읽어요', body: `${book.name}은 ‘${book.theme}’을 중심으로 흐릅니다. 선택한 장의 한 문장만 떼기보다 앞뒤 사건과 이 큰 흐름을 함께 보면 뜻이 더 또렷해져요.` },
      { title: '하나님은 어떤 분으로 나타나시나요?', body: '본문 속 명령이나 인물보다 먼저, 하나님이 무엇을 소중히 여기고 누구에게 다가가시는지 찾아보세요. 이것이 적용의 방향을 바로 잡아 줍니다.' },
      { title: '오늘 바꿀 한 가지를 고릅니다', body: guide.lens },
    ],
    illustration: `창문이 흐리면 바깥 풍경이 흐린 것이 아니라 내가 보는 유리가 흐린 것일 수 있어요. 말씀 묵상은 현실을 외면하는 일이 아니라, 욕심과 두려움으로 흐려진 시선을 닦아 하나님과 이웃을 다시 보는 일입니다. ${book.name} ${chapter}장을 읽으며 “본문이 틀렸다”보다 “내 시선에서 닦여야 할 것은 무엇인가”를 먼저 물어보세요.`,
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
    decision: `오늘 ${book.name} ${chapter}장의 가르침을 떠올리며, 가장 가까운 한 사람에게 진실하고 선한 행동 하나를 먼저 실천하겠습니다.`,
    prayer: `하나님, ${book.name}의 말씀을 제 생각에 억지로 맞추지 않고 잘 듣게 해 주세요. ‘${book.theme}’의 뜻을 오늘 제 관계와 선택 속에서 정직하게 살아내도록 지혜와 용기를 주세요. 아멘.`,
  };

  return { ...base, ...curated, points: curated?.points ?? base.points };
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
  if (compact.includes('왜') || compact.includes('맥락')) return `${sermon.context} 그래서 ${ref}는 앞뒤 문맥과 책 전체의 흐름을 함께 볼 때 오해를 줄일 수 있어요.`;
  return `${ref}의 핵심을 한 문장으로 말하면 “${sermon.summary}”입니다. 질문하신 부분을 이해할 때는 먼저 본문에서 반복되는 말과 앞뒤 단락을 확인해 보세요. 특정 구절이나 표현을 조금 더 적어 주시면 그 지점에 맞춰 더 쉽게 풀어드릴게요.`;
}

const QUICK_READINGS = [
  { label: '오늘', book: '잠언', chapter: 1, start: 1, end: 7 },
  { label: '위로', book: '시편', chapter: 23, start: 1, end: 6 },
  { label: '염려', book: '마태복음', chapter: 6, start: 25, end: 34 },
];

export default function Home() {
  const [book, setBook] = useState(BOOKS.find((item) => item.name === '잠언')!);
  const [chapter, setChapter] = useState(1);
  const [startVerse, setStartVerse] = useState(1);
  const [endVerse, setEndVerse] = useState(7);
  const [sermon, setSermon] = useState(() => makeSermon(BOOKS.find((item) => item.name === '잠언')!, 1));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draftBook, setDraftBook] = useState(book);
  const [draftChapter, setDraftChapter] = useState(chapter);
  const [draftStart, setDraftStart] = useState(startVerse);
  const [draftEnd, setDraftEnd] = useState(endVerse);
  const [testament, setTestament] = useState<'전체' | '구약' | '신약'>('전체');
  const [isGenerating, setIsGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [answering, setAnswering] = useState(false);
  const [notice, setNotice] = useState('');

  const ref = reference(book, chapter, startVerse, endVerse);
  const filteredBooks = useMemo(() => BOOKS.filter((item) => {
    const matchesTestament = testament === '전체' || item.testament === testament;
    const term = search.trim();
    return matchesTestament && (!term || item.name.includes(term) || item.short.includes(term));
  }), [search, testament]);

  useEffect(() => {
    const stored = window.localStorage.getItem('word-guide-font');
    if (stored) setFontScale(Number(stored));
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
    setPickerOpen(true);
  };

  const chooseReading = (reading: typeof QUICK_READINGS[number]) => {
    const nextBook = BOOKS.find((item) => item.name === reading.book)!;
    setBook(nextBook);
    setChapter(reading.chapter);
    setStartVerse(reading.start);
    setEndVerse(reading.end);
    setSermon(makeSermon(nextBook, reading.chapter));
    setChat([]);
    setSaved(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const generate = () => {
    const safeStart = Math.max(1, Math.min(176, draftStart));
    const safeEnd = Math.max(safeStart, Math.min(176, draftEnd));
    setPickerOpen(false);
    setIsGenerating(true);
    window.setTimeout(() => {
      setBook(draftBook);
      setChapter(draftChapter);
      setStartVerse(safeStart);
      setEndVerse(safeEnd);
      setSermon(makeSermon(draftBook, draftChapter));
      setChat([]);
      setSaved(false);
      setIsGenerating(false);
      setNotice(`${reference(draftBook, draftChapter, safeStart, safeEnd)} 해설을 준비했어요.`);
      window.setTimeout(() => setNotice(''), 2600);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 720);
  };

  const toggleSaved = () => {
    const next = !saved;
    setSaved(next);
    const key = 'word-guide-saved';
    const list = JSON.parse(window.localStorage.getItem(key) || '[]') as string[];
    const updated = next ? Array.from(new Set([ref, ...list])) : list.filter((item) => item !== ref);
    window.localStorage.setItem(key, JSON.stringify(updated));
    setNotice(next ? '묵상함에 저장했어요.' : '저장을 해제했어요.');
    window.setTimeout(() => setNotice(''), 2000);
  };

  const changeFont = () => {
    const next = fontScale >= 1.16 ? 0.94 : Number((fontScale + 0.11).toFixed(2));
    setFontScale(next);
    window.localStorage.setItem('word-guide-font', String(next));
    setNotice(`본문 글자 크기를 ${next > 1.1 ? '크게' : next > 1 ? '보통보다 조금 크게' : '보통으로'} 바꿨어요.`);
    window.setTimeout(() => setNotice(''), 2200);
  };

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || answering) return;
    setChat((current) => [...current, { role: 'user', text }]);
    setQuestion('');
    setAnswering(true);
    window.setTimeout(() => {
      setChat((current) => [...current, { role: 'guide', text: answerQuestion(text, sermon, ref) }]);
      setAnswering(false);
    }, 680);
  };

  return (
    <main className="app-shell" style={{ '--reading-scale': fontScale } as React.CSSProperties}>
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
                const active = reading.book === book.name && reading.chapter === chapter;
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
              <strong>본문은 성경책에서 먼저 읽어 주세요</strong>
              <span>이곳은 번역 성경 전문 대신 문맥과 쉬운 설명을 제공합니다.</span>
            </div>
          </aside>

          <article className={`sermon-panel ${isGenerating ? 'is-loading' : ''}`} id="today" aria-busy={isGenerating}>
            {isGenerating && (
              <div className="sermon-loading" role="status"><span className="loading-leaf">온</span><strong>말씀의 앞뒤 맥락을 살피고 있어요…</strong><small>잠시만 기다려 주세요.</small></div>
            )}
            <div className="passage-heading">
              <div>
                <p className="eyebrow accent">함께 읽을 말씀 · {book.testament} {book.group}</p>
                <button className="passage-title-button" type="button" onClick={openPicker}><h1>{ref}</h1><span aria-hidden="true">⌄</span></button>
                <p className="passage-subtitle">{sermon.summary}</p>
              </div>
              <button className={`icon-button ${saved ? 'saved' : ''}`} onClick={toggleSaved} type="button" aria-label={saved ? '말씀 저장 해제' : '말씀 저장'}>{saved ? '♥' : '♡'}</button>
            </div>

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
              <button type="button" onClick={() => { navigator.clipboard?.writeText(sermon.prayer); setNotice('기도문을 복사했어요.'); window.setTimeout(() => setNotice(''), 1800); }}>기도문 복사</button>
            </section>

            <details className="safety-details">
              <summary>AI 말씀 안내를 사용할 때 꼭 알아두세요</summary>
              <div>
                <p>이 서비스는 성경 이해를 돕는 해설 도구이며 하나님의 음성이나 뜻을 확정하지 않습니다. 교단과 신앙 전통에 따라 해석이 다를 수 있고, 목회자·의료·법률 등 전문 상담을 대신하지 않아요.</p>
                <p>폭력, 성적 피해, 재정 착취, 협박이 의심되면 먼저 안전을 확보하고 외부 전문기관이나 수사기관의 도움을 받으세요. 위급하거나 자신·다른 사람을 해칠 위험이 있다면 혼자 있지 말고 즉시 112·119 또는 가까운 응급실에 도움을 요청하세요.</p>
              </div>
            </details>
          </article>

          <aside className="companion-panel" aria-label="AI 말씀 질문">
            <p className="eyebrow">말씀 곁에 두기</p>
            <h2>오늘의 한 문장</h2>
            <blockquote>“주님, 빨리 아는 사람보다 바르게 배우는 사람이 되게 해주세요.”</blockquote>
            <div className="divider" />
            <h3>온유에게 말씀 물어보기</h3>
            <p>어려운 표현이나 오늘의 적용을 편하게 질문해 보세요.</p>
            <div className="quick-questions">
              {['이 말씀의 맥락은?', '오늘 어떻게 실천해요?', '짧게 기도해 줘'].map((item) => (
                <button key={item} type="button" onClick={() => setQuestion(item)}>{item}</button>
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
              <button type="submit" aria-label="질문 보내기" disabled={!question.trim() || answering}>↑</button>
            </form>
            <p className="care-note">AI가 예언·계시를 단정하거나 중대한 결정을 강요해서는 안 됩니다. 중요한 판단은 신뢰할 수 있는 목회자와 관련 전문가에게도 상의하세요.</p>
          </aside>
        </div>
      </section>

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
                    <button className={draftBook.name === item.name ? 'active' : ''} onClick={() => { setDraftBook(item); setDraftChapter(1); setDraftStart(1); setDraftEnd(7); }} type="button" key={item.name}>
                      <strong>{item.name}</strong><small>{item.chapters}장 · {item.group}</small>
                    </button>
                  ))}
                </div>
              </div>
              <aside className="range-panel">
                <p className="eyebrow">선택한 성경</p>
                <h3>{draftBook.name}</h3>
                <p>{draftBook.theme}</p>
                <label>장<select value={draftChapter} onChange={(event) => setDraftChapter(Number(event.target.value))}>{Array.from({ length: draftBook.chapters }, (_, i) => i + 1).map((item) => <option key={item} value={item}>{item}장</option>)}</select></label>
                <div className="verse-range">
                  <label>시작 절<input type="number" min="1" max="176" value={draftStart} onChange={(event) => { const value = Number(event.target.value); setDraftStart(value); if (value > draftEnd) setDraftEnd(value); }} /></label>
                  <span>–</span>
                  <label>마지막 절<input type="number" min={draftStart} max="176" value={draftEnd} onChange={(event) => setDraftEnd(Number(event.target.value))} /></label>
                </div>
                <div className="selected-reference">{reference(draftBook, draftChapter, Math.max(1, draftStart), Math.max(draftStart, draftEnd))}</div>
                <p className="picker-note">절 수는 성경책에서 확인해 주세요. 본문 전문은 사용하시는 성경 번역본에서 먼저 읽으면 좋아요.</p>
              </aside>
            </div>
            <footer><button className="quiet-button" type="button" onClick={() => setPickerOpen(false)}>취소</button><button className="primary-button wide" type="button" onClick={generate}>이 말씀 쉽게 풀어보기 <span>→</span></button></footer>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
