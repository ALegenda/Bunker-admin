import React, { useEffect, useRef, useState } from 'react';
import hero from '../assets/bunker-cartoon.webp';
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

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? '↗' : '→'}</span>;
}
function CardArt({ image, name }: { image: string; name: string }) {
  if (image === firstAid || image === soap) {
    return (
      <div className="game-card-art supply-face" role="img" aria-label={`Карточка «${name}»`}>
        <span>ПОЛЕЗНЫЙ ПРИПАС</span>
        <b>{name}</b>
        <img src={image} width="400" height="262" loading="lazy" alt="" />
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
function VaultMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="m20 2 15.6 9v18L20 38 4.4 29V11Z" fill="currentColor" />
      <circle cx="20" cy="20" r="10" stroke="var(--paper)" strokeWidth="2" />
      <circle cx="20" cy="20" r="3" fill="var(--paper)" />
      <path d="M20 10v7m0 6v7M10 20h7m6 0h7" stroke="var(--paper)" strokeWidth="2" />
    </svg>
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
  const root = useRef<HTMLDivElement>(null);
  const [activeRole, setActiveRole] = useState(0);
  const [activeSituation, setActiveSituation] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const role = roles[activeRole];
  const situation = situations[activeSituation];

  useEffect(() => {
    document.title = 'Бункер — выживать веселее в компании';
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setMotionPaused(media.matches);
    const update = () => setMotionPaused(media.matches);
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener(update);
    const elements = root.current?.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  entry.target.classList.add('is-visible');
                  observer?.unobserve(entry.target);
                }
              }
            },
            { threshold: 0.08 },
          );
    if (observer)
      elements?.forEach((element) => {
        // Keep prerendered content visible during hydration, including on slow mobile networks.
        if (element.getBoundingClientRect().top < window.innerHeight) return;
        element.classList.add('reveal-ready');
        observer.observe(element);
      });
    return () => {
      observer?.disconnect();
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener(update);
    };
  }, []);

  return (
    <div ref={root} className={`landing${motionPaused ? ' motion-paused' : ''}`}>
      <a className="landing-skip" href="#main-content">
        К содержанию
      </a>
      <header className="landing-header">
        <a href="/" className="landing-brand" aria-label="Бункер — главная">
          <VaultMark />
          <span>
            БУНКЕР<span className="brand-caption">ВЛАДИВОСТОК</span>
          </span>
        </a>
        <nav
          className={`landing-nav${menuOpen ? ' is-open' : ''}`}
          id="landing-navigation"
          aria-label="Главная навигация"
          onClick={() => setMenuOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setMenuOpen(false);
              document.getElementById('landing-menu')?.focus();
            }
          }}
        >
          <a href="#about">Что за игра?</a>
          <a href="#roles">Кто ты?</a>
          <a href="#cards">Карточки</a>
          <a href="#situations">Примеры ходов</a>
          <a href="#faq">Вопросы</a>
        </nav>
        <a className="landing-header-cta" href="/profile">
          Я уже игрок <Arrow diagonal />
        </a>
        <button
          className="landing-menu"
          id="landing-menu"
          aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={menuOpen}
          aria-controls="landing-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
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
              <a className="landing-button" href="#roles">
                Найти свою роль <Arrow />
              </a>
              <a className="landing-text-link" href="#about">
                А как играть? <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="hero-footnote">Скрытые роли. Коварные карты. Настоящие эмоции.</p>
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
              <img
                className="hero-art"
                src={hero}
                alt="Мультяшные жители бункера хитро улыбаются, играя в карты за общим столом"
                fetchPriority="high"
                width="1200"
                height="800"
              />
              <div className="art-card-caption">
                Сохраняйте спокойствие. <b>И свою роль в секрете.</b>
              </div>
            </div>
            <span className="hero-sticker" aria-hidden="true">
              БЛЕФ
              <br />
              <b>ВКЛЮЧЁН!</b>
              <span>✦ ✦ ✦</span>
            </span>
          </div>
          <div className="hero-bottom">
            <span>ОСТОРОЖНО: ДРУЖБА ПРОЙДЁТ ПРОВЕРКУ НА ПРОЧНОСТЬ</span>
            <button
              className="motion-toggle"
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused(!motionPaused)}
            >
              {motionPaused ? '▷ Включить анимации' : 'Ⅱ Пауза анимаций'}
            </button>
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
          <div className="section-intro" data-reveal>
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
              <article className={`step-card tone-${color}`} key={number} data-reveal>
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
          <div className="section-intro" data-reveal>
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
          <div className="role-selector" aria-label="Выбор роли">
            {roles.map((item, index) => (
              <button
                key={item.id}
                className={`role-pick tone-${item.color}`}
                aria-pressed={index === activeRole}
                aria-controls="role-dossier"
                onClick={() => setActiveRole(index)}
              >
                <span className="role-pick-top">
                  <span>СЕКРЕТНАЯ РОЛЬ</span>
                  <span aria-hidden="true">{index === activeRole ? '✓' : '↗'}</span>
                </span>
                <img
                  src={item.image}
                  width="237"
                  height="360"
                  loading="lazy"
                  alt={`Игровая карточка «${item.name}»`}
                />
                <strong>{item.name}</strong>
                <span className="role-pick-label">{item.label}</span>
              </button>
            ))}
          </div>
          <div
            className={`role-dossier tone-${role.color}`}
            id="role-dossier"
            aria-live="polite"
            aria-atomic="true"
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
          </div>
        </section>

        <section className="landing-cards-wrap" id="cards">
          <div className="landing-section">
            <div className="section-intro" data-reveal>
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
            <div className="example-grid">
              {examples.map((card) => (
                <a
                  className={`example-card tone-${card.color}`}
                  key={card.id}
                  href={'/catalog?card=' + card.id}
                  data-reveal
                >
                  <div className="example-art">
                    <span className="card-type">{card.type}</span>
                    <CardArt image={card.image} name={card.name} />
                    <span className="card-open" aria-hidden="true">
                      ↗
                    </span>
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
            <div className="catalog-invite">
              <p>
                <b>Это только начало колоды.</b>
                <br />
                Ещё больше способов удивить соседей — в каталоге.
              </p>
              <a className="landing-button" href="/catalog">
                Все карточки <Arrow diagonal />
              </a>
            </div>
          </div>
        </section>

        <section className="landing-section landing-situations" id="situations">
          <div className="section-intro" data-reveal>
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
          <div className="situation-selector" aria-label="Игровые ситуации">
            {situations.map((item, index) => (
              <button
                key={item.number}
                aria-pressed={index === activeSituation}
                aria-controls="situation-panel"
                onClick={() => setActiveSituation(index)}
              >
                <span>{item.number}</span>
                {item.name}
              </button>
            ))}
          </div>
          <div
            className={`situation-panel tone-${situation.color}`}
            id="situation-panel"
            aria-live="polite"
            aria-atomic="true"
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
          </div>
        </section>

        <section className="landing-section landing-faq" id="faq">
          <div data-reveal>
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
          <div className="faq-list" data-reveal>
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
          <div className="join-content" data-reveal>
            <span className="landing-eyebrow">УБЕЖИЩЕ НАЙДЕНО. ОСТАЛОСЬ ЗНАКОМСТВО.</span>
            <h2>
              Заходи.
              <br />У нас тут <em>интересно.</em>
            </h2>
            <p>
              Изучи карточки, познакомься с правилами
              <br className="desktop-break" /> и открой свой профиль игрока.
            </p>
            <div className="join-actions">
              <a className="landing-button" href="/profile">
                Открыть профиль <Arrow diagonal />
              </a>
              <a className="landing-button secondary" href="/catalog">
                Посмотреть карточки <Arrow />
              </a>
            </div>
            <span className="join-note">Вход через Telegram · Каталог без регистрации</span>
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
        <a href="/" className="landing-brand">
          <VaultMark />
          <span>
            БУНКЕР<span className="brand-caption">ВЛАДИВОСТОК</span>
          </span>
        </a>
        <p>
          Апокалипсис подождёт.
          <br />
          <b>Сначала ещё одну партию.</b>
        </p>
        <nav aria-label="Разделы для игроков">
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
