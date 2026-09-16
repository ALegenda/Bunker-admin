import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { descriptionHtml, encodeRichText } from '../../../shared/rich-text.js';

export function DescriptionEditor({
  value,
  onChange,
  label = 'Описание',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const current = useRef(onChange);
  current.current = onChange;
  const lastValue = useRef(value);
  const [error, setError] = useState('');
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        heading: { levels: [2, 3] },
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: descriptionHtml(value),
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        class: 'rich-description',
      },
    },
    onUpdate: ({ editor }) => {
      const next = encodeRichText(editor.getHTML());
      if (next.length > 100000) {
        setError('Описание слишком длинное. Сократите текст, чтобы сохранить.');
        return;
      }
      setError('');
      lastValue.current = next;
      current.current(next);
    },
  });
  useEffect(() => {
    if (editor && value !== lastValue.current) {
      editor.commands.setContent(descriptionHtml(value), { emitUpdate: false });
      lastValue.current = value;
    }
  }, [editor, value]);
  if (!editor) return null;
  const button = (
    title: string,
    text: React.ReactNode,
    action: () => void,
    active = false,
    disabled = false,
  ) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {text}
    </button>
  );
  return (
    <div className="description-field grow">
      <span>{label}</span>
      <div className="rich-editor">
        <div className="format-toolbar" role="toolbar" aria-label="Форматирование описания">
          {button(
            'Жирный (⌘/Ctrl+B)',
            <b>Ж</b>,
            () => editor.chain().focus().toggleBold().run(),
            editor.isActive('bold'),
          )}
          {button(
            'Курсив (⌘/Ctrl+I)',
            <i>К</i>,
            () => editor.chain().focus().toggleItalic().run(),
            editor.isActive('italic'),
          )}
          {button(
            'Подчёркнутый',
            <u>Ч</u>,
            () => editor.chain().focus().toggleUnderline().run(),
            editor.isActive('underline'),
          )}
          {button(
            'Зачёркнутый',
            <s>З</s>,
            () => editor.chain().focus().toggleStrike().run(),
            editor.isActive('strike'),
          )}
          <select
            aria-label="Стиль абзаца"
            value={
              editor.isActive('heading', { level: 2 })
                ? '2'
                : editor.isActive('heading', { level: 3 })
                  ? '3'
                  : 'p'
            }
            onChange={(e) =>
              e.target.value === 'p'
                ? editor.chain().focus().setParagraph().run()
                : editor
                    .chain()
                    .focus()
                    .setHeading({ level: Number(e.target.value) as 2 | 3 })
                    .run()
            }
          >
            <option value="p">Обычный текст</option>
            <option value="2">Заголовок</option>
            <option value="3">Подзаголовок</option>
          </select>
          {button(
            'Маркированный список',
            '• Список',
            () => editor.chain().focus().toggleBulletList().run(),
            editor.isActive('bulletList'),
          )}
          {button(
            'Нумерованный список',
            '1. Список',
            () => editor.chain().focus().toggleOrderedList().run(),
            editor.isActive('orderedList'),
          )}
          {button(
            'Цитата',
            '❝',
            () => editor.chain().focus().toggleBlockquote().run(),
            editor.isActive('blockquote'),
          )}
          <label className="color-control">
            Цвет{' '}
            <input
              type="color"
              aria-label="Цвет текста"
              defaultValue="#b42318"
              onInput={(e) => editor.chain().focus().setColor(e.currentTarget.value).run()}
            />
          </label>
          <label className="color-control">
            Маркер{' '}
            <input
              type="color"
              aria-label="Цвет выделения"
              defaultValue="#fff0a6"
              onInput={(e) =>
                editor.chain().focus().setHighlight({ color: e.currentTarget.value }).run()
              }
            />
          </label>
          {button(
            'Выделить маркером',
            'Маркер',
            () => editor.chain().focus().toggleHighlight({ color: '#fff0a6' }).run(),
            editor.isActive('highlight'),
          )}
          {button('Убрать форматирование', 'Очистить', () =>
            editor.chain().focus().unsetAllMarks().clearNodes().run(),
          )}
          {button(
            'Отменить',
            '↶',
            () => editor.chain().focus().undo().run(),
            false,
            !editor.can().undo(),
          )}
          {button(
            'Повторить',
            '↷',
            () => editor.chain().focus().redo().run(),
            false,
            !editor.can().redo(),
          )}
        </div>
        <EditorContent editor={editor} />
      </div>
      <small>Выделите текст и выберите форматирование. Можно использовать сочетания клавиш.</small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
