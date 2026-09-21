import React, { useEffect } from 'react';
import { Brand } from './Brand.js';
import { initLandingMenu } from '../landing-menu.js';
import hero from '../assets/bunker-cartoon.webp';
import hero480 from '../assets/bunker-cartoon-480.webp';
import hero800 from '../assets/bunker-cartoon-800.webp';
import heroAvif480 from '../assets/bunker-cartoon-480.avif';
import heroAvif800 from '../assets/bunker-cartoon-800.avif';
import heroAvif1200 from '../assets/bunker-cartoon-1200.avif';
import survivor from '../assets/survivor.webp';
import marauder from '../assets/marauder.webp';
import medic from '../assets/medic.webp';
import leader from '../assets/leader.webp';
import lawyer from '../assets/lawyer.webp';
import firstAid from '../assets/first-aid.webp';
import soap from '../assets/soap.webp';
import itSpecialist from '../assets/it-specialist.webp';
import secondChance from '../assets/second-chance.webp';
import '../landing.css';

const announcementsUrl = 'https://t.me/bunker_vl';

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <span className="landing-arrow" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h16m-6-6 6 6-6 6'} />
      </svg>
    </span>
  );
}
function CardArt({ image, name }: { image: string; name: string }) {
  if (image === firstAid || image === soap) {
    return (
      <div className="game-card-art supply-face" role="img" aria-label={`Карточка «${name}»`}>
        <span>ПОЛЕЗНЫЙ ПРИПАС</span>
        <b>{name}</b>
        <img src={image} width="400" height="262" loading="lazy" decoding="async" alt="" />
        <strong>{image === soap ? '3 применения' : 'Санитару в помощь'}</strong>
        <span aria-hidden="true">✦ ✦ ✦</span>
      </div>
    );
  }
  return (
    <img
      className="game-card-art"
      src={image}
      width="237"
      height="360"
      loading="lazy"
      alt={`Карточка «${name}»`}
    />
  );
}
const roles = [
  {
    id: 'role-survivor',
    name: 'Выживший',
    image: survivor,
    color: 'yellow',
    label: 'Найди своих. Вычисли чужих.',
    text: 'Днём обсуждай, голосуй и отправляйся за припасами. По ночам у обычного выжившего нет своего действия — зато карта умения может открыть новые возможности. Наблюдай: чей рассказ сегодня не сходится?',
    quote: '«Ребята, мне-то можно доверять!»',
  },
  {
    id: 'role-marauder',
    name: 'Мародёр',
    image: marauder,
    color: 'pink',
    label: 'Улыбайся. Тебя пока не раскрыли.',
    text: 'Днём играй вместе со всеми: обсуждай, голосуй и добывай припасы. Ночью просыпайся с сообщниками и выбирай жертву. Твоя задача — не выдать свою сторону и убедить соседей, что ты здесь самый мирный.',
    quote: '«Какие мародёры? Впервые слышу».',
  },
  {
    id: 'role-medic',
    name: 'Санитар',
    image: medic,
    color: 'mint',
    label: 'Спасай жизни. Не забывай о себе.',
    text: 'Ночью выбери одного игрока для лечения: себя или кого-то из соседей. Одного и того же человека нельзя лечить два хода подряд. Придётся решить, кому помощь нужнее именно сейчас.',
    quote: '«Не волнуйтесь, я почти доктор».',
  },
];
const examples = [
  {
    id: '0',
    name: 'Лидер',
    type: 'Умение',
    image: leader,
    color: 'yellow',
    fact: 'Два голоса вместо одного',
    text: 'Назначай участников вылазки и распределяй добытые припасы. С большой властью приходит много споров.',
  },
  {
    id: '2',
    name: 'Адвокат',
    type: 'Умение',
    image: lawyer,
    color: 'mint',
    fact: 'Возражаю! Голосовать нельзя.',
    text: 'Ночью защити себя или другого игрока от дневного голосования. Протекция доступна через раз.',
  },
  {
    id: '128',
    name: 'Аптечка',
    type: 'Припас',
    image: firstAid,
    color: 'pink',
    fact: 'Один санитар. Два спасения.',
    text: 'Проснись вместе с санитаром и стань его ассистентом: он сможет вылечить двух других игроков.',
  },
  {
    id: '176',
    name: 'Мыло',
    type: 'Припас',
    image: soap,
    color: 'blue',
    fact: 'Смой неприятности. Буквально.',
    text: 'Убирай известные тебе эффекты с себя или других. Всего три применения — расходуй с умом.',
  },
  {
    id: 'merc-dc943632cc4f',
    name: 'Айтишник',
    type: 'Наёмник',
    image: itSpecialist,
    color: 'mint',
    fact: 'Пробовали взломать бункер?',
    text: 'Взломай одну из систем: камеры, вентиляцию, двери или подсчёт голосов. Тут есть где развернуться.',
  },
  {
    id: '219',
    name: 'Второй шанс',
    type: 'Мёртвый бонус',
    image: secondChance,
    color: 'yellow',
    fact: 'Кубики, давайте ещё раз!',
    text: 'Передай игроку повторный бросок. Засчитывается новый результат — даже если он хуже первого.',
  },
];
const situations = [
  {
    name: 'Спасти двоих',
    stamp: 'НОЧЬ В БУНКЕРЕ',
    number: '01',
    title: 'У санитара появился ассистент.',
    setup: 'У тебя есть аптечка. Ты активируешь её и просыпаешься вместе с санитаром.',
    action:
      'Теперь санитар может выбрать двух игроков для лечения. Ты помогаешь, а решение принимает он.',
    result: 'Два игрока получают лечение вместо одного.',
    detail: 'При таком совместном лечении нельзя выбрать ни санитара, ни его ассистента.',
    images: [
      { src: medic, name: 'Санитар' },
      { src: firstAid, name: 'Аптечка' },
    ],
    link: '128',
    color: 'mint',
    symbol: '+',
  },
  {
    name: 'Переиграть бросок',
    stamp: 'РИСК НА ВЫЛАЗКЕ',
    number: '02',
    title: 'Кубики подвели? Есть второй шанс.',
    setup: 'На вылазке выпал неудачный результат. Но выбывшие передали тебе «Второй шанс».',
    action: 'Используй карту и брось кубики ещё раз. Засчитывается именно последний бросок.',
    result: 'Новый результат выше первого? Получи ещё и карту умения!',
    detail:
      'Риск остаётся: второй результат может оказаться хуже. Карта работает и в дуэлях, и в других ситуациях с кубиками.',
    images: [
      { src: survivor, name: 'Выживший' },
      { src: secondChance, name: 'Второй шанс' },
    ],
    link: '219',
    color: 'yellow',
    symbol: '↻',
  },
  {
    name: 'Пережить голосование',
    stamp: 'СЮРПРИЗ НА ОБСУЖДЕНИИ',
    number: '03',
    title: 'Все против тебя. А голосовать нельзя.',
    setup:
      'У тебя умение «Адвокат». Ночью ты назначаешь протекцию себе, предчувствуя жаркое обсуждение.',
    action:
      'На дневном голосовании никто не может проголосовать против тебя. У соседей меняются планы.',
    result: 'Ты защищён от голосов на этот день.',
    detail: 'Протекция действует через раз и не защищает от всех остальных опасностей бункера.',
    images: [
      { src: survivor, name: 'Выживший' },
      { src: lawyer, name: 'Адвокат' },
    ],
    link: '2',
    color: 'pink',
    symbol: '+',
  },
];
const questions = [
  [
    'Как попасть на игру?',
    'Вступай в нашу Telegram-группу @bunker_vl: там публикуем анонсы живых игр во Владивостоке. Следи за новостями и выбирай, когда присоединиться. Профиль на сайте для просмотра анонсов не нужен.',
  ],
  [
    'Что за игра «Бункер»?',
    'Это живая социальная игра в мире после ядерной катастрофы. Выжившие и мародёры скрывают свои роли, ищут союзников и пытаются вычислить друг друга. Умения, припасы и вылазки делают каждую партию новой историей.',
  ],
  [
    'Я новичок. Разберусь?',
    'Да. Начни со своей роли и общего хода игры: днём обсуждение и голосование, ночью — тайные действия. Особенности умений и припасов можно изучать постепенно. Полные описания карточек и правил есть в каталоге.',
  ],
  [
    'Это как «Мафия», только в бункере?',
    'Скрытые стороны и блеф знакомы, но здесь у каждого ещё и карта умения. Есть вылазки за припасами, дуэли и неожиданные комбинации. А «мёртвые бонусы» позволяют влиять на партию даже после выбывания.',
  ],
  [
    'Что происходит на вылазке?',
    'Игроки уходят из бункера на день и ночь за припасами. Там нет обычного дневного голосования и ночного нападения мародёров из бункера, но есть свои опасности и броски кубиков. Выжившие возвращаются с добычей, которую распределяет лидер. Подробности — в правилах каталога.',
  ],
  [
    'Здесь можно играть онлайн?',
    'Сейчас сайт помогает подготовиться к живой игре: изучить карточки, почитать правила и открыть свой профиль. Автоматического проведения онлайн-партий здесь пока нет.',
  ],
  [
    'Зачем мне профиль?',
    'В профиле хранятся игровое имя, уровень, баланс и достижения. Вход — через Telegram. Показатели и прогресс достижений обновляет администратор. Каталог доступен без регистрации.',
  ],
];

export function Landing() {
  useEffect(initLandingMenu, []);

  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">
        К содержанию
      </a>
      <header className="landing-header">
        <Brand className="landing-brand" />
        <nav className="landing-nav" aria-label="Главная навигация">
          <a href="#about">Что за игра?</a>
          <a href="#roles">Кто ты?</a>
          <a href="#cards">Карточки</a>
          <a href="#situations">Примеры ходов</a>
          <a href="#faq">Вопросы</a>
        </nav>
        <a
          className="landing-header-cta"
          href={announcementsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Анонсы игр в Telegram"
        >
          Анонсы игр <Arrow diagonal />
        </a>
        <details className="landing-mobile-menu">
          <summary className="landing-menu" aria-label="Меню" aria-controls="landing-mobile-nav">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path className="menu-open-icon" d="M5 6h14M5 12h14M5 18h14" />
              <path className="menu-close-icon" d="m6 6 12 12M6 18 18 6" />
            </svg>
          </summary>
          <nav id="landing-mobile-nav" aria-label="Мобильная навигация">
            <a href="#about">Что за игра?</a>
            <a href="#roles">Кто ты?</a>
            <a href="#cards">Карточки</a>
            <a href="#situations">Примеры ходов</a>
            <a href="#faq">Вопросы</a>
          </nav>
        </details>
      </header>
      <main className="landing-main" id="main-content">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="landing-eyebrow">
              <span className="tiny-star" aria-hidden="true">
                ✳
              </span>{' '}
              ЖИВАЯ ИГРА • ВЛАДИВОСТОК
            </span>
            <h1 id="hero-title">
              КОНЕЦ СВЕТА?
              <br />
              <span>
                НАЧАЛО
                <br />
                ВЕЧЕРИНКИ!
              </span>
            </h1>
            <p className="hero-description">
              Снаружи — апокалипсис. Внутри — друзья, блеф и подозрительно хороший план выживания.
            </p>
            <div className="hero-actions">
              <a
                className="landing-button"
                href={announcementsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Анонсы игр в Telegram <Arrow diagonal />
              </a>
              <a className="landing-text-link" href="#about">
                А как играть? <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="hero-footnote">
              Присоединяйся к нашей группе @bunker_vl,
              <br /> чтобы не пропустить следующую игру.
            </p>
          </div>
          <div className="hero-visual">
            <div className="hero-speech">
              Все свои.
              <br />
              <strong>Ну… почти.</strong>
            </div>
            <div className="hero-art-card">
              <div className="art-card-label">
                <span>ПАМЯТКА ЖИТЕЛЯ БУНКЕРА</span>
                <span>№ 001</span>
              </div>
              <picture>
                <source
                  type="image/avif"
                  srcSet={`${heroAvif480} 480w, ${heroAvif800} 800w, ${heroAvif1200} 1200w`}
                  sizes="(max-width: 620px) calc(100vw - 48px), (max-width: 1408px) 48vw, 660px"
                />
                <img
                  className="hero-art"
                  src={hero}
                  srcSet={`${hero480} 480w, ${hero800} 800w, ${hero} 1200w`}
                  sizes="(max-width: 620px) calc(100vw - 48px), (max-width: 1408px) 48vw, 660px"
                  alt="Мультяшные жители бункера хитро улыбаются, играя в карты за общим столом"
                  fetchPriority="high"
                  decoding="async"
                  width="1200"
                  height="800"
                />
              </picture>
              <div className="art-card-caption">
                Сохраняйте спокойствие. <b>И свою роль в секрете.</b>
              </div>
            </div>
          </div>
          <div className="hero-bottom">
            <span>ОСТОРОЖНО: ДРУЖБА ПРОЙДЁТ ПРОВЕРКУ НА ПРОЧНОСТЬ</span>
          </div>
        </section>
        <div className="landing-ribbon" aria-hidden="true">
          <span>ДОВЕРЯЙ ИНТУИЦИИ</span>
          <b>✳</b>
          <span>ПОДОЗРЕВАЙ СОСЕДА</span>
          <b>✳</b>
          <span>ИГРАЙ СВОЮ РОЛЬ</span>
          <b>✳</b>
        </div>

        <section className="landing-section landing-about" id="about">
          <div className="section-intro">
            <div>
              <span className="landing-eyebrow">01 / КРАТКИЙ КУРС ВЫЖИВАНИЯ</span>
              <h2>
                Хорошая компания.
                <br />
                <em>Плохие подозрения.</em>
              </h2>
            </div>
            <p>
              Вы пережили катастрофу и укрылись в бункере. Но среди выживших прячутся мародёры. Кто
              друг, а кто просто очень убедительно кивает? Пора выяснить.
            </p>
          </div>
          <div className="steps-grid">
            {[
              [
                '01',
                'Получи свой секрет',
                'Твоя роль определяет сторону. Карта умения даёт особые возможности. Раскрывать всё соседям совсем не обязательно.',
                'РОЛЬ + УМЕНИЕ',
                'yellow',
                '✦',
              ],
              [
                '02',
                'Убеди весь бункер',
                'Днём обсуждай, заключай союзы и голосуй. Хочешь припасов? На вылазке ждёт добыча. И немного неприятностей.',
                'ОБСУЖДЕНИЕ + РИСК',
                'mint',
                '☀',
              ],
              [
                '03',
                'Устрой сюрприз',
                'Ночью мародёры и санитар делают тайные ходы. Утром вы узнаете, чьи планы сработали. И начнёте подозревать заново.',
                'ТАЙНЫЕ ДЕЙСТВИЯ',
                'pink',
                '☾',
              ],
            ].map(([number, title, text, tag, color, symbol]) => (
              <article className={`step-card tone-${color}`} key={number}>
                <div className="step-card-top">
                  <span>ШАГ {number}</span>
                  <b aria-hidden="true">{symbol}</b>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
                <span className="step-tag">{tag}</span>
              </article>
            ))}
          </div>
          <a href="/catalog?type=правило" className="landing-text-link section-link">
            Все правила — в открытом каталоге <Arrow diagonal />
          </a>
        </section>

        <section className="landing-section landing-roles" id="roles">
          <div className="section-intro">
            <div>
              <span className="landing-eyebrow">02 / ЗНАКОМЬТЕСЬ, ВАШИ СОСЕДИ</span>
              <h2>
                Улыбка одна.
                <br />
                <em>Намерения разные.</em>
              </h2>
            </div>
            <p>
              Выживший, мародёр или санитар?
              <br />
              Нажми на карточку и узнай, какие планы у её владельца на эту ночь.
            </p>
          </div>
          <fieldset className="role-explorer choice-explorer">
            <legend className="landing-sr-only">Выбор роли</legend>
            {roles.map((item, index) => (
              <input
                key={item.id}
                className="choice-input"
                type="radio"
                name="landing-role"
                id={`role-choice-${index}`}
                defaultChecked={index === 0}
                aria-controls={`role-dossier-${index}`}
              />
            ))}
            <div className="role-selector">
              {roles.map((item, index) => (
                <label
                  key={item.id}
                  className={`role-pick tone-${item.color}`}
                  htmlFor={`role-choice-${index}`}
                >
                  <span className="role-pick-top">
                    <span>СЕКРЕТНАЯ РОЛЬ</span>
                    <span className="role-selection-mark" aria-hidden="true">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        focusable="false"
                      >
                        <path className="role-selection-arrow" d="M6 18 18 6M6 6h12v12" />
                        <path className="role-selection-check" d="m5 12 4 4L19 6" />
                      </svg>
                    </span>
                  </span>
                  <img
                    src={item.image}
                    width="237"
                    height="360"
                    loading="lazy"
                    decoding="async"
                    alt={`Игровая карточка «${item.name}»`}
                  />
                  <strong>{item.name}</strong>
                  <span className="role-pick-label">{item.label}</span>
                </label>
              ))}
            </div>
            <div className="role-panels">
              {roles.map((role, index) => (
                <article
                  key={role.id}
                  className={`role-dossier tone-${role.color}`}
                  id={`role-dossier-${index}`}
                  aria-label={role.name}
                >
                  <div>
                    <span className="landing-eyebrow">ТВОЯ РОЛЬ: {role.name.toUpperCase()}</span>
                    <h3>{role.quote}</h3>
                  </div>
                  <div>
                    <p>{role.text}</p>
                    <a href={'/catalog?card=' + role.id} className="landing-text-link">
                      Полное описание роли <Arrow diagonal />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="landing-cards-wrap" id="cards">
          <div className="landing-section">
            <div className="section-intro">
              <div>
                <span className="landing-eyebrow">03 / НЕ ТОЛЬКО КРАСИВЫЕ КАРТИНКИ</span>
                <h2>
                  Маленькая карточка.
                  <br />
                  <em>Большой поворот.</em>
                </h2>
              </div>
              <p>
                Умения, припасы, наёмники и бонусы.
                <br />
                Вот шесть примеров из колоды. Каждый — повод придумать новый план.
              </p>
            </div>
            <div className="catalog-invite">
              <p>
                <b>Это только начало колоды.</b>
                <br />
                Ещё больше способов удивить соседей — в каталоге.
              </p>
              <a className="landing-button secondary" href="/catalog">
                Все карточки <Arrow diagonal />
              </a>
            </div>
            <div className="example-grid">
              {examples.map((card) => (
                <a
                  className={`example-card tone-${card.color}`}
                  key={card.id}
                  href={'/catalog?card=' + card.id}
                >
                  <div className="example-art">
                    <span className="card-type">{card.type}</span>
                    <CardArt image={card.image} name={card.name} />
                  </div>
                  <div className="example-copy">
                    <h3>{card.name}</h3>
                    <strong>{card.fact}</strong>
                    <p>{card.text}</p>
                    <span className="example-link">
                      Читать правила карты <Arrow />
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-situations" id="situations">
          <div className="section-intro">
            <div>
              <span className="landing-eyebrow">04 / А ТЕПЕРЬ ПРЕДСТАВЬ…</span>
              <h2>
                Твой ход.
                <br />
                <em>И вот что из этого вышло.</em>
              </h2>
            </div>
            <p>
              Три ситуации из мира Бункера.
              <br />
              Переключай примеры — увидишь, как карточки меняют игру.
            </p>
          </div>
          <fieldset className="situation-explorer choice-explorer">
            <legend className="landing-sr-only">Игровые ситуации</legend>
            {situations.map((item, index) => (
              <input
                key={item.number}
                className="choice-input"
                type="radio"
                name="landing-situation"
                id={`situation-choice-${index}`}
                defaultChecked={index === 0}
                aria-controls={`situation-panel-${index}`}
              />
            ))}
            <div className="situation-selector">
              {situations.map((item, index) => (
                <label key={item.number} htmlFor={`situation-choice-${index}`}>
                  <span>{item.number}</span>
                  {item.name}
                </label>
              ))}
            </div>
            <div className="situation-panels">
              {situations.map((situation, index) => (
                <article
                  key={situation.number}
                  className={`situation-panel tone-${situation.color}`}
                  id={`situation-panel-${index}`}
                  aria-label={situation.name}
                >
                  <div className="situation-art">
                    <span className="landing-eyebrow">{situation.stamp}</span>
                    <div className="situation-card-pair">
                      {situation.images.map((item, index) => (
                        <React.Fragment key={item.src}>
                          {index === 1 && (
                            <b className="pair-symbol" aria-hidden="true">
                              {situation.symbol}
                            </b>
                          )}
                          <CardArt image={item.src} name={item.name} />
                        </React.Fragment>
                      ))}
                    </div>
                    <span className="situation-art-note">ДВЕ КАРТЫ. ОДНА НОВАЯ ИСТОРИЯ.</span>
                  </div>
                  <div className="situation-copy">
                    <h3>{situation.title}</h3>
                    <p>
                      <b>Ситуация.</b> {situation.setup}
                    </p>
                    <p>
                      <b>Твой ход.</b> {situation.action}
                    </p>
                    <div className="situation-result">
                      <span>ЧТО ПОЛУЧИЛОСЬ</span>
                      <strong>{situation.result}</strong>
                    </div>
                    <p className="situation-detail">{situation.detail}</p>
                    <a className="landing-text-link" href={'/catalog?card=' + situation.link}>
                      Проверить правило в каталоге <Arrow diagonal />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="landing-section landing-faq" id="faq">
          <div>
            <span className="landing-eyebrow">05 / БЕЗ ПАНИКИ</span>
            <h2>
              Есть вопросы?
              <br />
              <em>Есть ответы.</em>
            </h2>
            <div className="faq-note">
              <span aria-hidden="true">✳</span>
              <p>
                Первое правило бункера:
                <br />
                <b>спрашивать — можно.</b>
              </p>
            </div>
          </div>
          <div className="faq-list">
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <span className="faq-plus" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-join" id="join">
          <div className="join-decoration" aria-hidden="true">
            ✳
          </div>
          <div className="join-content">
            <span className="landing-eyebrow">ХОЧЕШЬ ОКАЗАТЬСЯ ПО ТУ СТОРОНУ КАРТОЧКИ?</span>
            <h2>
              Следующая игра —
              <br />
              <em>с тобой?</em>
            </h2>
            <p>
              Анонсы встреч во Владивостоке — в нашей Telegram-группе.
              <br className="desktop-break" /> Присоединяйся, чтобы не пропустить свою партию.
            </p>
            <div className="join-actions">
              <a
                className="landing-button"
                href={announcementsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Перейти в группу <Arrow diagonal />
              </a>
              <a className="landing-text-link" href="/catalog">
                Сначала изучить карточки <Arrow />
              </a>
            </div>
            <span className="join-note">
              @bunker_vl · Живые игры, новые знакомые и немного блефа
            </span>
          </div>
          <div className="join-stamp" aria-hidden="true">
            ПРОВЕРЕНО
            <br />
            <b>ВЫЖИВШИМИ</b>
            <span>★ ★ ★</span>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand className="landing-brand" />
        <p>
          Апокалипсис подождёт.
          <br />
          <b>Сначала ещё одну партию.</b>
        </p>
        <nav aria-label="Полезные ссылки">
          <a href={announcementsUrl} target="_blank" rel="noopener noreferrer">
            Анонсы игр в Telegram <Arrow diagonal />
          </a>
          <a href="/catalog">
            Каталог <Arrow diagonal />
          </a>
          <a href="/profile">
            Профиль <Arrow diagonal />
          </a>
          <a href="#hero-title" aria-label="Вернуться наверх">
            Наверх ↑
          </a>
        </nav>
        <div className="footer-bottom">
          <span>БУНКЕР · ЖИВАЯ ИГРА НА ВЫЖИВАНИЕ</span>
          <span>СОХРАНЯЙ ЧУВСТВО ЮМОРА.</span>
        </div>
      </footer>
    </div>
  );
}
