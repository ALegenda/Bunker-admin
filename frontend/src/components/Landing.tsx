import React, { useEffect, useRef, useState } from 'react';
import hero from '../assets/bunker-hero.webp';
import survivor from '../assets/survivor.webp';
import marauder from '../assets/marauder.webp';
import medic from '../assets/medic.webp';
import '../landing.css';

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? '↗' : '→'}</span>;
}
function VaultMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="m20 2 15.6 9v18L20 38 4.4 29V11Z" stroke="currentColor" strokeWidth="2" />
      <circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="2" />
      <circle cx="20" cy="20" r="3" fill="currentColor" />
      <path d="M20 10v7m0 6v7M10 20h7m6 0h7" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
const roles = [
  {
    id: 'role-survivor',
    name: 'Выживший',
    label: 'Найди своих. Раскрой чужих.',
    number: '01',
    image: survivor,
    color: '#d5f568',
    text: 'Ты пережил катастрофу. Теперь нужно вычислить мародёров, найти союзников и сохранить бункер. Твоё главное оружие — наблюдательность. И карта умения, о которой никто не знает.',
    trait: 'ДОВЕРИЕ — ТВОЙ РЕСУРС',
  },
  {
    id: 'role-marauder',
    name: 'Мародёр',
    label: 'Будь своим. До наступления ночи.',
    number: '02',
    image: marauder,
    color: '#ff9277',
    text: 'Днём ты обсуждаешь, голосуешь и добываешь припасы вместе со всеми. Ночью действуешь со своими сообщниками. Убеди остальных, что тебе можно доверять, и не выдай свою сторону.',
    trait: 'ТВОЯ ТАЙНА — ТВОЁ ОРУЖИЕ',
  },
  {
    id: 'role-medic',
    name: 'Санитар',
    label: 'Один выбор. Чья-то жизнь.',
    number: '03',
    image: medic,
    color: '#83dbcb',
    text: 'Пока бункер спит, ты можешь спасти одного из игроков. Себя или союзника? Интуиция и внимание к деталям решают всё. Одного и того же человека нельзя лечить два хода подряд.',
    trait: 'ТВОЙ ХОД МОЖЕТ ВСЁ ИЗМЕНИТЬ',
  },
];
const questions = [
  [
    'Что за игра «Бункер»?',
    'Это живая социальная игра в мире после ядерной катастрофы. Выжившие и мародёры скрывают свои роли, ищут союзников и пытаются вычислить друг друга. Умения, припасы и вылазки делают каждую партию новой историей.',
  ],
  [
    'Я никогда не играл. Мне подойдёт?',
    'Да. Начни с основных ролей и общего хода игры — дневного обсуждения, голосования и ночных действий. Остальные возможности можно изучать постепенно. В каталоге есть описания карточек и правил, к которым удобно обращаться во время подготовки.',
  ],
  [
    'Чем игра отличается от «Мафии»?',
    'Помимо тайной роли, у тебя есть карта умения, способная изменить ход партии. Добавь к этому добычу припасов на вылазках, дуэли и «мёртвые бонусы»: даже выбывшие участники могут влиять на происходящее.',
  ],
  [
    'Здесь можно играть онлайн?',
    'Сейчас сайт помогает подготовиться к живой игре: разобраться в карточках, почитать правила и следить за своим профилем. Автоматического проведения онлайн-партий на сайте пока нет.',
  ],
  [
    'Для чего нужен профиль?',
    'В профиле хранятся игровое имя, уровень, баланс и достижения. Войти можно через Telegram. Игровые показатели и прогресс достижений обновляет администратор. Каталог открыт и без входа.',
  ],
];

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [activeRole, setActiveRole] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const role = roles[activeRole];

  useEffect(() => {
    document.title = 'Бункер — конец света. Начало игры.';
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setMotionPaused(media.matches);
    const update = () => setMotionPaused(media.matches);
    media.addEventListener('change', update);
    const elements = root.current?.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    elements?.forEach((element) => {
      element.classList.add('reveal-ready');
      observer.observe(element);
    });
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
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
          <a href="#about">Об игре</a>
          <a href="#how">Как играть</a>
          <a href="#roles">Твоя роль</a>
          <a href="#faq">Вопросы</a>
          <a className="landing-player-link" href="/catalog">
            Игрокам <Arrow diagonal />
          </a>
        </nav>
        <a className="landing-header-cta" href="#join">
          В бункер <Arrow diagonal />
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
          <img
            className="hero-art"
            src={hero}
            alt=""
            fetchPriority="high"
            width="1536"
            height="1024"
          />
          <div className="hero-shade" />
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-dust" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="hero-content">
            <div className="landing-eyebrow hero-enter">
              <span className="signal-dot" /> ЖИВАЯ ИГРА. НАСТОЯЩИЕ ЭМОЦИИ.
            </div>
            <h1 id="hero-title" className="hero-enter">
              КОНЕЦ СВЕТА.
              <br />
              <span>НАЧАЛО ИГРЫ.</span>
            </h1>
            <p className="hero-description hero-enter">
              За дверью — новый мир. За столом — свои и чужие.
              <br className="desktop-break" /> Убеждай, рискуй, заключай союзы.
              <br className="desktop-break" /> Здесь доверие — самый опасный ресурс.
            </p>
            <div className="hero-actions hero-enter">
              <a className="landing-button" href="#join">
                Хочу в бункер <Arrow diagonal />
              </a>
              <a className="landing-text-link" href="#how">
                <span className="play-icon" aria-hidden="true">
                  ▷
                </span>{' '}
                Как проходит игра
              </a>
            </div>
            <div className="hero-note hero-enter">
              <span>СКРЫТЫЕ РОЛИ</span>
              <i /> <span>НЕОЖИДАННЫЕ СОЮЗЫ</span>
              <i />
              <span>ТВОИ РЕШЕНИЯ</span>
            </div>
          </div>
          <div className="hero-coordinates" aria-hidden="true">
            43°07′ N &nbsp; 131°54′ E<br />
            <span>УБЕЖИЩЕ · ВЛАДИВОСТОК</span>
          </div>
          <div className="hero-door-label" aria-hidden="true">
            <span /> ПО ТУ СТОРОНУ — НЕИЗВЕСТНОСТЬ
          </div>
          <div className="hero-bottom">
            <a href="#about">
              <span>↓</span> СПУСКАЙСЯ ГЛУБЖЕ
            </a>
            <button
              className="motion-toggle"
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused(!motionPaused)}
            >
              {motionPaused ? '▷ Включить анимации' : 'Ⅱ Пауза анимаций'}
            </button>
          </div>
        </section>

        <div className="landing-ticker" aria-hidden="true">
          <div>
            {[0, 1].map((copy) => (
              <span key={copy}>
                ДОВЕРЯЙ ИНТУИЦИИ <b>✳</b> СОМНЕВАЙСЯ В КАЖДОМ <b>✳</b> МЕНЯЙ ХОД ИГРЫ <b>✳</b>{' '}
              </span>
            ))}
          </div>
        </div>

        <section className="landing-section landing-about" id="about">
          <div className="section-heading" data-reveal>
            <span className="landing-eyebrow">01 / ПОСЛЕ КАТАСТРОФЫ</span>
            <span className="section-code" aria-hidden="true">
              [ НОВАЯ РЕАЛЬНОСТЬ ]
            </span>
          </div>
          <div className="about-intro" data-reveal>
            <h2>
              Опасность снаружи.
              <br />
              <span>Интрига — внутри.</span>
            </h2>
            <div>
              <p>
                Мир пережил ядерную катастрофу. Вы укрылись в бункере. Но среди выживших скрываются
                те, у кого совсем другие планы.
              </p>
              <p>
                «Бункер» — игра о людях, решениях и умении читать между строк. Здесь обычный
                разговор становится поединком, а одна карта переворачивает всё.
              </p>
            </div>
          </div>
          <div className="feature-grid">
            <article data-reveal>
              <span className="feature-number">
                01 <span aria-hidden="true">◉</span>
              </span>
              <h3>У каждого — секрет</h3>
              <p>
                Твоя роль известна только тебе. Доверие придётся заслужить, а чужой блеф —
                распознать.
              </p>
              <span className="feature-tag">ПСИХОЛОГИЯ И БЛЕФ</span>
            </article>
            <article data-reveal>
              <span className="feature-number">
                02 <span aria-hidden="true">ϟ</span>
              </span>
              <h3>Один ход меняет всё</h3>
              <p>
                Умения, припасы и неожиданные комбинации. Даже самый надёжный план может не пережить
                эту ночь.
              </p>
              <span className="feature-tag">ТАКТИКА И РИСК</span>
            </article>
            <article data-reveal>
              <span className="feature-number">
                03 <span aria-hidden="true">↻</span>
              </span>
              <h3>Выбыл? Ещё не конец.</h3>
              <p>
                «Мёртвые бонусы» позволяют влиять на игру после выбывания. Твоя история ещё
                продолжается.
              </p>
              <span className="feature-tag">В ИГРЕ ДО ПОСЛЕДНЕГО</span>
            </article>
          </div>
        </section>

        <section className="landing-how" id="how">
          <div className="landing-section">
            <div className="section-heading" data-reveal>
              <span className="landing-eyebrow">02 / ПРАВИЛА ВЫЖИВАНИЯ</span>
              <span className="section-code" aria-hidden="true">
                [ ДЕНЬ → НОЧЬ → НОВЫЙ ДЕНЬ ]
              </span>
            </div>
            <h2 data-reveal>
              Каждый раунд —<br />
              <span>новый повод не доверять.</span>
            </h2>
            <div className="steps-grid">
              {[
                [
                  '01',
                  'Получи свою роль',
                  'Узнай, на чьей ты стороне. Изучи своё умение. И сохрани главное в секрете.',
                  'СЕКРЕТНЫЙ ДОПУСК',
                ],
                [
                  '02',
                  'Убеди остальных',
                  'Обсуждай, строй союзы и голосуй. Отправляйся на вылазки за припасами — на свой страх и риск.',
                  'ДНЕВНАЯ ФАЗА',
                ],
                [
                  '03',
                  'Сделай свой ход',
                  'Бункер засыпает. Мародёры и санитар действуют втайне. Утром станет ясно, кому удалось пережить ночь.',
                  'НОЧНАЯ ФАЗА',
                ],
              ].map(([number, title, text, tag]) => (
                <article key={number} data-reveal>
                  <span className="step-number">{number}</span>
                  <span className="landing-eyebrow">{tag}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
            <a href="/catalog?type=правило" className="landing-text-link rules-link">
              Разобраться в правилах <Arrow />
            </a>
          </div>
        </section>

        <section className="landing-section landing-roles" id="roles">
          <div className="section-heading" data-reveal>
            <span className="landing-eyebrow">03 / НИКТО НЕ ТОТ, КЕМ КАЖЕТСЯ</span>
            <span className="section-code" aria-hidden="true">
              [ ЛИЧНЫЕ ДЕЛА ]
            </span>
          </div>
          <div className="roles-layout" data-reveal>
            <div className="roles-copy">
              <h2>
                Кем ты станешь
                <br />
                <span>за этой дверью?</span>
              </h2>
              <p className="roles-lead">
                Одна из этих тайн может стать твоей.
                <br />
                Выбери роль, чтобы заглянуть в её историю.
              </p>
              <div className="role-selector" aria-label="Выбор роли">
                {roles.map((item, index) => (
                  <button
                    key={item.id}
                    aria-pressed={index === activeRole}
                    aria-controls="role-dossier"
                    onClick={() => setActiveRole(index)}
                  >
                    <span className="role-index">{item.number}</span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.label}</small>
                    </span>
                    <Arrow />
                  </button>
                ))}
              </div>
            </div>
            <div
              className="role-dossier"
              id="role-dossier"
              style={{ '--role-accent': role.color } as React.CSSProperties}
            >
              <div className="dossier-top">
                <span>СЕКРЕТНО / РОЛЬ {role.number}</span>
                <span aria-hidden="true">⌖</span>
              </div>
              <div className="role-art-stage">
                <div className="role-orbit" aria-hidden="true" />
                <img
                  key={role.image}
                  src={role.image}
                  width="237"
                  height="360"
                  loading="lazy"
                  alt={`Игровая карточка «${role.name}»`}
                />
              </div>
              <div className="role-details" aria-live="polite" aria-atomic="true">
                <span className="landing-eyebrow">{role.trait}</span>
                <p>{role.text}</p>
                <a href={'/catalog?card=' + role.id}>
                  Досье в каталоге <Arrow diagonal />
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-quote" aria-label="Девиз игры">
          <p data-reveal>
            «Я точно мирный».
            <br />
            <span>
              Звучит убедительно.
              <br className="mobile-break" /> До первой ночи.
            </span>
          </p>
          <span className="landing-eyebrow" data-reveal>
            В БУНКЕРЕ КАЖДОЕ СЛОВО ИМЕЕТ ВЕС
          </span>
        </section>

        <section className="landing-section landing-faq" id="faq">
          <div data-reveal>
            <span className="landing-eyebrow">04 / ПЕРЕД ВХОДОМ</span>
            <h2>
              Остались
              <br />
              <span>вопросы?</span>
            </h2>
            <p>
              Всё, что нужно знать
              <br />
              до знакомства с бункером.
            </p>
          </div>
          <div className="faq-list" data-reveal>
            {questions.map(([question, answer], index) => (
              <details key={question}>
                <summary>
                  <span className="faq-index">0{index + 1}</span>
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
          <div className="join-ring" aria-hidden="true" />
          <div className="join-content" data-reveal>
            <span className="landing-eyebrow">
              <span className="signal-dot" /> ТВОЯ СЛЕДУЮЩАЯ ИСТОРИЯ
            </span>
            <h2>
              Ну что,
              <br />
              ты с нами<span>?</span>
            </h2>
            <p>
              Познакомься с миром Бункера.
              <br />
              Изучи карточки. Открой профиль. Найди свою роль.
            </p>
            <div className="join-actions">
              <a className="landing-button" href="/profile">
                Присоединиться <Arrow diagonal />
              </a>
              <a className="landing-text-link" href="/catalog">
                Сначала изучить карточки <Arrow />
              </a>
            </div>
            <span className="join-note">Профиль через Telegram · Каталог без регистрации</span>
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
          Снаружи — конец света.
          <br />
          Здесь — начало твоей истории.
        </p>
        <nav aria-label="Разделы для игроков">
          <a href="/catalog">
            Каталог карточек <Arrow diagonal />
          </a>
          <a href="/profile">
            Личный кабинет <Arrow diagonal />
          </a>
        </nav>
        <a className="back-top" href="#hero-title" aria-label="Вернуться наверх">
          ↑
        </a>
        <div className="footer-bottom">
          <span>БУНКЕР · ЖИВАЯ ИГРА НА ВЫЖИВАНИЕ</span>
          <span>СДЕЛАЙ СВОЙ ХОД.</span>
        </div>
      </footer>
    </div>
  );
}
