import React from 'react';
import { renderToString } from 'react-dom/server';
import { Landing } from './components/Landing.js';

export function renderLanding() {
  return renderToString(<Landing />);
}
