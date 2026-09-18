// Colors describe the printed border, never the illustration or an item's material.
export const cardColors = {
  оранжевый: '#ed801d',
  розовый: '#ed0060',
  жёлтый: '#e2cd00',
  зелёный: '#a8c623',
  голубой: '#509cec',
  сиреневый: '#bc9cbc',
  фиолетовый: '#6952ac',
  коричневый: '#79500b',
  'тёмно-синий': '#123d50',
  бирюзовый: '#147f90',
  оливковый: '#788541',
  'тёмно-зелёный': '#408035',
  красный: '#df3021',
  'чёрно-жёлтый': '#252525',
} as const;
export type CardColor = keyof typeof cardColors;
export const cardColorNames = Object.keys(cardColors) as [CardColor, ...CardColor[]];
export const effectSuggestions = [
  'бессмертие',
  'иммунитет на голосовании',
  'паралич',
  'отравление',
  'телохранитель',
  'связь жизней',
  'подчинение',
  'молчание',
  'блокировка способностей',
  'заминирован',
  'радиация',
  'ярость',
  'пожар',
  'забей',
] as const;
