import React from 'react';
import { descriptionHtml } from '../../../shared/rich-text.js';
export function RichDescription({ value }: { value: string }) {
  return (
    <div
      className="rich-description"
      dangerouslySetInnerHTML={{ __html: descriptionHtml(value) }}
    />
  );
}
