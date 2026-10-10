"""Build the reviewed layout migration without modifying the immutable PDF import.

Uses only the standard library. Inline marks are sliced with their text, so colors,
emphasis and every rule survive paragraph/list boundaries. Run from the repo root:
  python3 scripts/format-card-descriptions.py
  node --import tsx scripts/finalize-description-formatting.ts
"""
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'resources/rules-2026-05-24'
PREFIX = '<!--bunker-rich-text:v1-->'

# Each group is (item beginnings, first text AFTER the list). These boundaries
# were reviewed against all 329 descriptions, including lists lost during import.
LISTS = {
    'pdf24-03b3a1581d8c': [(['1 волна', '2 волна', '3 волна', '4 волна'], '*Выбрать')],
    '5': [(['1)', '2)', '3)', '4)'], None)],
    '7': [(['Обрез*', 'Кожаная куртка*', 'Связка коктейлей'], 'И САМОЕ')],
    '26': [(['1,2 –', '3,4 –', '5,6 –'], None)],
    '29': [(['1.', '2.'], '**поймут')],
    '30': [(['- В случае победы', '- В случае неудачи'], None)],
    '36': [(['- Если при публичном', '- Если вы мародёр', '- А если вы санитар'], 'Сколько людей')],
    '39': [(['1)', '2)'], 'Важно помнить')],
    '42': [(['1)', '2)', '3)'], 'Выпасть данное')],
    '43': [(['1.', '2.', '3.', '4.'], 'Изначально реализация')],
    'pdf24-3e5bbc568c9e': [(['- страдает он', '- страдают его близкие'], 'Как только он')],
    '44': [(['- только мародёры', '- только выжившие', '- 1 мародер'], '*если какая-то')],
    '47': [(['- Стрельбище', '- Имитация разминирования', '- Жаростойкость'], None)],
    'pdf24-2f2d1eacecca': [(['В одной банке', 'Во второй банке', 'В третьей банке'], 'И напоследок')],
    '48': [(['1 сутки на вылазке', '2 суток на вылазке', '3 суток на вылазке'], 'Заряд одноразовый')],
    '51': [(['1 угаданный участник', '2 угаданных участников', '3 угаданных', '4 угаданных'], None)],
    'pdf24-eb513d34480d': [(['2 зеленых –', '2 фиолетовых –', '1 зеленая +'], 'Давать сыворотку')],
    '65': [(['1)', '2)'], None)],
    '66': [(['- если он пойдёт кого-то убивать', '- если пойдёт кого-то лечить', '- если пойдёт на вылазку', '- если применит'], None)],
    '75': [(['1)', '2)', '3)', '4)', '5)'], None)],
    '76': [(['Рука –', 'Нога –', 'Голова –'], 'Чтобы отрастить')],
    'pdf24-109377157d3c': [(['Кассета «Осень', 'Кассета «Зима', 'Кассета «Весна', 'Кассета «Лето'], '*Есть проблема')],
    '93': [(['- Электричества', '- Водоснабжения', '- Радиосвязи'], 'Также за успешно')],
    '106': [(['1)', '2)', '3)', '4)', '5)'], None)],
    '111': [(['1.', '2.', '3.'], 'Чем сложнее тренировка')],
    '117': [(['- Если вы сядете рядом с Санитаром', '- Если вы сядете между', '- Если сядете рядом с Лидером'], 'Последствия от карты')],
    'pdf24-7937a55c1caf': [(['За выжившего', 'За мародёра', 'За санитара'], None)],
    '121': [(['№1', '№2', '№3'], 'Чеки выписываются')],
    '122': [(['Чемодан из Казино', 'Чемодан из Полицейского', 'Чемодан из Почты', 'Чемодан из Тюрьмы', 'Чемодан из АЗС', 'Чемодан из Кофейни'], None)],
    '123': [(['- Томатный суп', '- Макароны', '- Печенье'], 'Добровольцы могут'), (['1 комплимент', '2 комплимента', '3 комплимента', '4 комплимента'], None)],
    '215': [(['в заброшенную больницу', 'в оружейный магазин', 'в продуктовый маркет'], 'Если победите всех')],
    'pdf24-8170ca7fdd6c': [(['Главным героем', 'Злодеем', 'Второстепенным персонажем'], None)],
    '223': [(['1)', '2)'], None)],
    '226': [(['1.', '2.'], 'Сначала принимается')],
    'pdf24-2fec44260b2c': [(['Жёлтая кнопка', 'Зеленая кнопка', 'Синяя кнопка', 'Красная кнопка'], 'Нажимать можно')],
    '245': [(['- Публично применил', '- Отдал свой голос'], None)],
    'pdf24-800b8d6c37f4': [(['Попугай –', 'Змея –', 'Кошка –', 'Хомяк –'], 'Получится ли')],
    'pdf24-48a6d9a60756': [(['- жизнь лишающее', '- жизнь спасающее', '- голоса снимающее', '- правду вскрывающее'], 'Ведущий подскажет')],
    '253': [(['Четное -', 'Нечетное –', 'Точная сумма –'], '*Если ваша ставка')],
    'pdf24-6b60b7ad418c': [(['1.', '2.'], None)],
    '131': [(['Канистра –', 'Коктейль Молотова –'], None)],
    '148': [(['1)', '2)'], 'Внимание:')],
    '149': [(['Жёлтый дым –', 'Красный дым –', 'Жёлтый и красный дым'], 'Действие дыма')],
    '154': [(['1)', '2)'], 'Наполненную канистру')],
    '155': [(['1)', '2)'], 'Важно помнить')],
    '163': [(['1)', '2)', '3)', '4)', '5)'], None)],
    '164': [(['- получить умение', '- стать обладателем', '- отравиться'], 'Также данную консерву')],
    'pdf24-e4c9825e72fe': [(['1.', '2.', '3.', '4.'], 'После того как')],
    '170': [(['Синяя Марка', 'Красная марка'], 'Киллер придёт')],
    '173': [(['1)', '2)'], None)],
    '178': [(['Собаку –', 'Крысу –', 'Ворону –'], 'Питомцы пропадают')],
    '189': [(['1)', '2)', '3)', '4)'], None)],
    'pdf24-d39e5b578e0d': [(['1)', '2)', '3)'], None)],
    '194': [(['1.', '2.', '3.'], '*если уйдете')],
    'pdf24-392ff20a663e': [(['Ветчина -', 'Курица –', 'Лосось –'], 'Также данным сэндвичем')],
    '196': [(['Лицо зомби', 'Черепашка –', 'Колючая проволока'], None)],
    '198': [(['1.', '2.', '3.'], None)],
    '199': [(['- Лидерство', '- Припас', '- Смерть'], 'Какой туз')],
    '204': [(['1-4 –', '5-8 –', '9-12 –', '13-более –'], None)],
    '207': [(['препарат “A”', 'препарат “B”', 'препарат “C”'], 'Вы не сможете')],
    'merc-dc943632cc4f': [(['- видеонаблюдения', '- подсчёта голосов', '- вентиляции', '- блокировки главных', '- блокировки дверей комнат'], 'Если хозяин')],
    'merc-4061bf8cd0df': [(['А) Перелом руки', 'Б) Перелом Грудной', 'В) Перелом Шеи'], 'Перелом определяется'), (['- Перелом руки', '- Перелом Грудной', '- Перелом шеи'], None)],
    'merc-12f6e896cb1c': [(['Пытка «Зубная фея»', 'Пытка «Русская рулетка»', 'Пытка «Водолаз»'], '(Данная функция бесплатная)')],
    'merc-2b28ae0dc51e': [(['- Вы имеете право', '- Ночью второй', '- К вам не зайдут', '- На каждом голосовании'], '(Данная функция бесплатная)')],
    'merc-5eb29c7acba1': [(['- вы можете выбрать', '- Вы можете выбрать'], 'Определение случайности')],
    'merc-0b49c1dfca24': [(['- Назначит человека', '- Бонусом устроит'], '(Данная функция бесплатная)')],
    'merc-48ada16177e8': [(['Мародер должен', 'Выживший должен', 'Санитар должен'], 'В случае если')],
    'merc-41ff2c2b089e': [(['1-3 –', '4-8 –', '9-14 –', '15-21 –', '22 и выше –'], 'Стоимость –')],
    'merc-473482d25820': [(['Если вы мародер', 'Если вы выживший', 'Если вы Санитар'], '(Данная функция бесплатная.)')],
    'merc-a5b6a7f844d1': [(['Лев –', 'Паук –', 'Акула –', 'Гадюка –'], '(Данная функция бесплатная)')],
    'merc-ecce80b11052': [(['За 500$', 'За 1000$', 'За 2000$'], None)],
}

# Extra semantic boundaries that aren't sentence boundaries in the imported text.
BREAKS = {
    'rule-intro': ['В игре –'],
    'rule-outing': ['Одна из них', 'Вторая опасность', 'Так же, если на вылазку', 'Каждый вернувшийся'],
    'rule-dead': ['Как и все игроки', 'Будьте внимательны', 'Мертвые игроки также', 'Когда в игре осталось'],
    'role-marauder': ['Мародеры прикидываются', 'Внимание:', 'Когда мародёры', 'Но если среди', 'Если никто'],
    'role-medic': ['На моей практике', 'Касательно того'],
    '0': ['Лидер определяет', 'По возвращению', 'Кстати, если лидером'],
    '6': ['В обмен на карту игрока'],
    '17': ['Если вы должны были покинуть игру из-за того, что вас убили', 'Если вы должны были покинуть игру из-за того, что вас выгнали', '(Не забывайте'],
    '53': ['При первой попытке', 'При второй попытке'],
    'pdf24-eb513d34480d': ['Вы будете вытягивать'],
    '60': ['Ваши зомби', 'Стоит помнить', 'Если в течение игры', 'Если у вас украдут'],
    '64': ['Вы можете совершить', 'Либо совершить'],
    '109': ['Участник с наивысшим', 'Пассивное наличие'],
    '120': ['Зеленая (четное число)', 'Новую пробирку', 'Эффект Паралич*'],
    '122': ['Попытка открыть чемодан'],
    '212': ['«Побогаче» значит', 'Богач, за кем', 'Лидер в торгах'],
    'pdf24-2fec44260b2c': ['Человек, который нажимает'],
    '235': ['(1 –умение'],
    '250': ['Взять игрок может'],
    'pdf24-054ee883a671': ['Любое воспламенение', 'Чтобы найти и перекрыть'],
    '144': ['Если не произошло', 'Если произошёл'],
    '158': ['Дорога к нему', 'Как понять какое настроение', 'Четное число на двух кубиках', 'Нечетное число –'],
    '179': ['Для выживших/', 'Для Санитара'],
    '195': ['1 таблетка –'],
    'pdf24-4782982e5adb': ['Если человек, который был склеен'],
    'merc-53b6854621a5': ['Пинч в это время'],
    'merc-5c5258da08e6': ['Действие голода'],
    'merc-d16d6090edf9': ['Ночью же', 'Если к вам пришёл', 'Хозяина данного'],
    'merc-9f472be641c1': ['После 1 удара', 'После 2 удара'],
    'merc-a5b6a7f844d1': ['Крест -'],
    'merc-ecce80b11052': ['За деньги -', 'Есть проблема!'],
}


class RichRuns(HTMLParser):
    def __init__(self, value):
        super().__init__(convert_charrefs=True)
        self.runs, self.stack, self.paragraphs = [], [], []
        self.omissions = []
        self.position = 0
        self.feed(value.removeprefix(PREFIX))

    def append(self, value, stack):
        self.runs.append((self.position, value, tuple(stack)))
        self.position += len(value)

    def handle_starttag(self, tag, attrs):
        if tag == 'p':
            if self.position:
                self.append(' ', [])
            self.paragraphs.append(self.position)
        elif tag == 'br':
            self.append(' ', [])
        else:
            opening = '<' + tag + ''.join(' ' + k + '="' + html.escape(v, quote=True) + '"' for k, v in attrs) + '>'
            self.stack.append((tag, opening))

    def handle_endtag(self, tag):
        if tag != 'p':
            assert self.stack[-1][0] == tag, tag
            self.stack.pop()

    def handle_data(self, value):
        self.append(value, self.stack)

    @property
    def text(self):
        return ''.join(value for _, value, _ in self.runs)

    def render(self, start, end, bold_end=None):
        # Close and reopen inline marks at a split; never slice serialized HTML.
        result, active = '', ()
        for offset, value, stack in self.runs:
            lo, hi = max(start, offset), min(end, offset + len(value))
            if lo >= hi:
                continue
            cuts = sorted({lo, hi}
                | ({bold_end} if bold_end and lo < bold_end < hi else set())
                | {p for pair in self.omissions for p in pair if lo < p < hi})
            for a, b in zip(cuts, cuts[1:]):
                if any(x <= a and b <= y for x, y in self.omissions):
                    continue
                desired = stack
                if bold_end and a < bold_end and not any(tag == 'strong' for tag, _ in stack):
                    desired = (('strong', '<strong>'),) + stack
                common = 0
                while common < min(len(active), len(desired)) and active[common] == desired[common]:
                    common += 1
                result += ''.join('</' + tag + '>' for tag, _ in reversed(active[common:]))
                result += ''.join(opening for _, opening in desired[common:])
                result += html.escape(value[a-offset:b-offset])
                active = desired
        return result + ''.join('</' + tag + '>' for tag, _ in reversed(active))


def locate(text, prefix, after=0):
    match = re.search(r'(?<!\S)' + re.escape(prefix), text[after:])
    assert match, (prefix, text[after:])
    return after + match.start()


def sentences(text, start, end):
    # Sentence breaks outside parenthetical explanations and quoted card names.
    depth, quote, candidates = 0, None, []
    for i in range(start, end):
        ch = text[i]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth = max(0, depth - 1)
        elif ch in '«“':
            quote = ch
        elif ch in '»”':
            quote = None
        if depth or quote or ch not in '.!?':
            continue
        match = re.match(r'\s+([А-ЯЁ])', text[i+1:end])
        if match:
            candidates.append(i + 1 + match.start(1))
    return candidates


def format_card(entry):
    rich = RichRuns(entry['description'])
    text = rich.text
    groups, boundaries = [], {0, len(text)}
    # Ignore imported breaks in the middle of a sentence (a dash was mistaken
    # for a list marker), but retain authored paragraphs and footnotes.
    for pos in rich.paragraphs[1:]:
        if not re.match(r'[–—-]\s', text[pos:]):
            boundaries.add(pos)
    for prefix in BREAKS.get(entry['id'], []):
        boundaries.add(locate(text, prefix))
    for prefixes, stop in LISTS.get(entry['id'], []):
        items, cursor = [], 0
        for prefix in prefixes:
            cursor = locate(text, prefix, cursor)
            items.append(cursor)
            cursor += len(prefix)
        end = locate(text, stop, cursor) if stop else len(text)
        groups.append((items, end))
        boundaries.update(items + [end])
    # This PDF placed the three tattoo list markers in separate text objects;
    # the old import inserted them in the middle of each sentence. Move that
    # numbering back to native list markers without touching the tattoo rules.
    if entry['id'] == '196':
        for items, end in groups:
            for number, (a, b) in enumerate(zip(items, items[1:] + [end]), 1):
                marker = re.search(r'(?<!\S)' + str(number) + r'\.\s+', text[a:b])
                assert marker
                rich.omissions.append((a + marker.start(), a + marker.end()))
    # Standalone notes and paid services, including notes buried in a paragraph.
    for match in re.finditer(r'(?<!\S)(?:\*{1,2}(?=[А-Яа-яЁё])|За \d+\$|\(Данная функция бесплатн)', text):
        if not any(items[0] <= match.start() < end for items, end in groups):
            boundaries.add(match.start())

    def paragraphs(start, end, label=False):
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end-1].isspace():
            end -= 1
        if start == end:
            return ''
        cuts, previous = [start], start
        for pos in sentences(text, start, end):
            current = pos - previous
            transition = re.match(r'(?:Если|В случае|Также|Так же|Но |Чтобы|Примечание|Внимание|Важно|Стоит помнить|Нельзя|Запрещ|При этом|По факту|Кроме|Иной вариант)', text[pos:])
            if current >= 350 or (transition and current >= 160):
                cuts.append(pos)
                previous = pos
        cuts.append(end)
        bold_end = None
        if label:
            # Keep choice labels short: the result, not the whole explanation.
            lead = re.match(r'.{1,70}?\s[–—-]\s', text[start:end])
            if lead:
                bold_end = start + lead.end()
        return ''.join('<p>' + rich.render(a, b, bold_end) + '</p>' for a, b in zip(cuts, cuts[1:]))

    pieces, cursor = [], 0
    for items, end in groups:
        points = sorted({cursor, items[0]} | {p for p in boundaries if cursor < p < items[0]})
        for a, b in zip(points, points[1:]):
            pieces.append(paragraphs(a, b))
        numbered = entry['id'] == '196' or all(re.match(r'\d+[.)]\s', text[p:]) for p in items)
        tag = 'ol' if numbered else 'ul'
        lis = []
        for a, b in zip(items, items[1:] + [end]):
            marker = re.match(r'\d+[.)]\s*' if numbered else r'-\s+', text[a:b])
            if marker:
                a += marker.end()
            lis.append('<li>' + paragraphs(a, b, label=True) + '</li>')
        pieces.append('<' + tag + '>' + ''.join(lis) + '</' + tag + '>')
        cursor = end
    points = sorted({cursor, len(text)} | {p for p in boundaries if cursor < p < len(text)})
    for a, b in zip(points, points[1:]):
        pieces.append(paragraphs(a, b))
    result = PREFIX + ''.join(pieces)
    # Only list punctuation/ordinals may be replaced by native HTML markers.
    expected = text
    removals = rich.omissions.copy()
    for items, end in groups:
        numbered = all(re.match(r'\d+[.)]\s', text[p:]) for p in items)
        for p in items:
            marker = re.match(r'\d+[.)]\s*' if numbered else r'-\s+', text[p:end])
            if marker:
                removals.append((p, p + marker.end()))
    for a, b in reversed(sorted(removals)):
        expected = expected[:a] + expected[b:]
    visible = re.sub(r'<[^>]*>', '', result.removeprefix(PREFIX))
    assert re.sub(r'\s', '', html.unescape(visible)) == re.sub(r'\s', '', expected), entry['name']
    return result


if __name__ == '__main__':
    source = json.loads((DIRECTORY / 'manifest.json').read_text())
    entries = []
    for entry in source['entries']:
        entries.append({
            'id': entry['id'], 'name': entry['name'], 'cardType': entry['cardType'],
            'before': entry['description'], 'description': format_card(entry),
        })
    target = ROOT / 'tmp/description-formatting-raw.json'
    target.write_text(json.dumps({
        'id': 'rules-2026-10-10-description-formatting',
        'sourceSha256': source['sourceSha256'], 'entries': entries,
    }, ensure_ascii=False, indent=2) + '\n')
    print(f'Reviewed {len(entries)} descriptions; raw plan: {target}')
