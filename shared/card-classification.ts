import { cardColorNames, type CardColor } from './card-metadata.js';

export const timeValues = ['дневная', 'ночная'] as const;
export const placeValues = ['внутри бункера', 'снаружи'] as const;
export const usageValues = [
  'одноразовая',
  'двухразовая',
  'трёхразовая',
  'многоразовая',
  'по условию',
] as const;
export const effectNotes: Record<string, string> = { забей: 'Этот эффект нельзя снять' };

export const colorLabels: Record<CardColor, string> = {
  оранжевый: 'оранжевая',
  розовый: 'розовая',
  жёлтый: 'жёлтая',
  зелёный: 'зелёная',
  голубой: 'голубая',
  сиреневый: 'сиреневая',
  фиолетовый: 'фиолетовая',
  коричневый: 'коричневая',
  'тёмно-синий': 'тёмно-синяя',
  бирюзовый: 'бирюзовая',
  оливковый: 'оливковая',
  'тёмно-зелёный': 'тёмно-зелёная',
  красный: 'красная',
  'чёрно-жёлтый': 'чёрно-жёлтая',
};
export const valueKey = (value: string) =>
  value.normalize('NFC').trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
const aliases: Record<string, string> = {
  дневное: 'дневная',
  ночное: 'ночная',
  одноразовое: 'одноразовая',
  двухразовое: 'двухразовая',
  трехразовое: 'трёхразовая',
  трёхразовое: 'трёхразовая',
  трехразовая: 'трёхразовая',
  многоразовое: 'многоразовая',
  'на вылазке': 'снаружи',
  металлический: 'металлическая',
  огнестрельный: 'огнестрельная',
  взрывоопасный: 'взрывоопасная',
  легковоспламеняющийся: 'легковоспламеняющаяся',
  медицинский: 'медицинская',
  съедобный: 'съедобная',
  'опасная личность*': 'опасная личность',
};
for (const color of cardColorNames) {
  aliases[color] = colorLabels[color];
  aliases[color.replaceAll('ё', 'е')] = colorLabels[color];
  aliases[colorLabels[color].replaceAll('ё', 'е')] = colorLabels[color];
}
export function canonicalValue(value: string): string {
  const key = valueKey(value);
  return Object.hasOwn(aliases, key) ? aliases[key] : key;
}
export function colorForLabel(value: string): CardColor | undefined {
  const label = canonicalValue(value);
  return cardColorNames.find((color) => colorLabels[color] === label);
}
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
export function normalizeTime(values: string[]) {
  return unique(
    values.flatMap((value) => {
      const parts = valueKey(value)
        .split(/\s*[/,–—-]\s*/)
        .map(canonicalValue);
      return parts.every((part) => timeValues.includes(part as (typeof timeValues)[number]))
        ? parts
        : [canonicalValue(value)];
    }),
  ).sort((a, b) => timeValues.indexOf(a as 'дневная') - timeValues.indexOf(b as 'дневная'));
}
export function normalizePlace(values: string[]) {
  return unique(
    values.flatMap((value) => {
      const key = valueKey(value);
      if (
        [
          'везде',
          'внутри и снаружи',
          'внутри бункера-на вылазке',
          'внутри бункера/на вылазке',
          'внутри бункера/снаружи',
        ].includes(key)
      )
        return [...placeValues];
      return [canonicalValue(value)];
    }),
  ).sort((a, b) => placeValues.indexOf(a as 'снаружи') - placeValues.indexOf(b as 'снаружи'));
}
export function normalizeUsageDetails(value: string) {
  // Preserve variable limits instead of inventing a fixed number of uses.
  if (/^1\s*[-/]\s*2\s*[-/]\s*3\s*разов[ао][яе]$/.test(valueKey(value))) {
    return 'одноразовая / двухразовая / трёхразовая';
  }
  const parts = valueKey(value)
    .split(/\s*[/,–—-]\s*/)
    .map(canonicalValue);
  if (parts.every((part) => usageValues.includes(part as (typeof usageValues)[number]))) {
    return unique(parts)
      .sort(
        (a, b) => usageValues.indexOf(a as 'одноразовая') - usageValues.indexOf(b as 'одноразовая'),
      )
      .join(' / ');
  }
  return canonicalValue(value);
}

export function normalizeUsage(value: string) {
  const detail = normalizeUsageDetails(value);
  return !detail || usageValues.includes(detail as (typeof usageValues)[number])
    ? detail
    : 'по условию';
}

type Attributes = {
  activationTime: string[];
  usageFrequency: string;
  usageCondition?: string;
  dangerousPersonality?: boolean;
  usageLocation: string[];
  tags: string[];
  effects?: string[];
  cardColor?: CardColor | '';
};
export function normalizeAttributes<T extends Attributes>(input: T): T & Attributes {
  const activationTime = normalizeTime(input.activationTime);
  let usageFrequency = normalizeUsage(input.usageFrequency);
  let usageCondition =
    input.usageCondition?.trim() ||
    (usageFrequency === 'по условию' && canonicalValue(input.usageFrequency) !== 'по условию'
      ? normalizeUsageDetails(input.usageFrequency)
      : '');
  let dangerousPersonality = input.dangerousPersonality || false;
  let cardColor = input.cardColor;
  const rawTags = input.tags.map(canonicalValue);
  const usageLocation = normalizePlace(input.usageLocation).filter((value) => {
    if (value === 'опасная личность') {
      rawTags.push(value);
      return false;
    }
    return true;
  });
  const effects = unique((input.effects || []).map(canonicalValue)).filter((value) => {
    if (value === 'опасная личность') {
      rawTags.push(value);
      return false;
    }
    return true;
  });
  const tags = unique(rawTags).filter((tag) => {
    if (tag === 'опасная личность') {
      if (input.dangerousPersonality !== false) dangerousPersonality = true;
      return false;
    }
    const color = colorForLabel(tag);
    if (color && (!cardColor || cardColor === color)) {
      cardColor = color;
      return false;
    }
    if (timeValues.includes(tag as 'дневная')) {
      activationTime.push(tag);
      return false;
    }
    if (placeValues.includes(tag as 'снаружи')) {
      usageLocation.push(tag);
      return false;
    }
    if (usageValues.includes(tag as 'одноразовая')) {
      if (!usageFrequency) usageFrequency = tag;
      if (usageFrequency === tag) return false;
    }
    // A duplicate effect label adds no information. Other thematic tags are retained.
    return !effects.includes(tag);
  });
  const result = {
    ...input,
    activationTime: normalizeTime(activationTime),
    usageFrequency,
    usageLocation: normalizePlace(usageLocation),
    tags,
  };
  if (cardColor) result.cardColor = cardColor;
  if (dangerousPersonality) result.dangerousPersonality = true;
  else delete result.dangerousPersonality;
  if (usageFrequency === 'по условию' && usageCondition) result.usageCondition = usageCondition;
  else delete result.usageCondition;
  if (effects.length) result.effects = effects;
  else delete result.effects;
  return result;
}
